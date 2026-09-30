import { PingFlag, type Ping } from "@fleet/protocol";
import type { LatLon } from "@fleet/routes";
import { positionAt, type RoadNetwork, type RoutePath } from "./network";
import type { Rng } from "./random";
import { TRUCK_MAX_SPEED_MS, lagosHour, targetSpeed, timeOfDayFactor, withinRadius, zoneAt } from "./traffic";

export type VehicleStatus = "moving" | "loading";

export interface VehicleInfo {
  id: number;
  plate: string;
  driver: string;
}

/** The tracker's behaviour, separate from how the truck drives. */
export interface DeviceConfig {
  /** Standard deviation of GPS error on each axis, metres. */
  gpsSigmaM: number;
  /** Share of devices whose clocks are badly wrong, by up to `maxSkewMs`. */
  skewedShare: number;
  maxSkewMs: number;
  /** Every other device is off by a normal error with this standard deviation. */
  normalSkewSdMs: number;
  movingIntervalMs: number;
  /** Parked trucks report less often, as real trackers do to save data. */
  parkedIntervalMs: number;
  gapZoneCount: number;
  gapZoneRadiusM: number;
  /**
   * Power losses per device per hour of simulated time (a loose connector, a
   * tracker unplugged to hide a detour). The device records nothing while off,
   * unlike a coverage gap, where it records and sends the backlog later.
   */
  outagesPerHour: number;
  outageMinMs: number;
  outageMaxMs: number;
}

export const DEFAULT_DEVICE: DeviceConfig = {
  gpsSigmaM: 4,
  skewedShare: 0.02,
  maxSkewMs: 180_000,
  normalSkewSdMs: 150,
  movingIntervalMs: 1000,
  parkedIntervalMs: 30_000,
  gapZoneCount: 3,
  gapZoneRadiusM: 600,
  outagesPerHour: 0.02,
  outageMinMs: 60_000,
  outageMaxMs: 8 * 60_000,
};

/** How the drivers behave, separate from the roads and the trackers. */
export interface DriverConfig {
  /** Share of drivers who ignore the laden-truck cap where the road allows it. */
  speederShare: number;
  speederCapMs: number;
}

export const DEFAULT_DRIVERS: DriverConfig = {
  speederShare: 0.02,
  speederCapMs: 80 / 3.6,
};

/**
 * One truck's habits, drawn from its own streams (see Simulation). Optional, so
 * a truck built without them drives carefully and its tracker never fails.
 */
export interface Habits {
  speedCapMs: number;
  /** Draws for this device's power losses. Absent means it never loses power. */
  power?: Rng;
}

/** An area with no mobile coverage. Devices record while inside and send everything on the way out. */
export interface GapZone {
  center: LatLon;
  radiusM: number;
}

/** Where the truck really is. The simulator knows it; the dispatcher only ever sees pings. */
export interface Truth {
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  status: VehicleStatus;
  pathId: string;
  distanceAlong: number;
  /** The tracker has lost power and is recording nothing. */
  deviceOff: boolean;
}

const ACCEL_MS2 = 0.6;
const DECEL_MS2 = 1.5;
const METRES_PER_DEG_LAT = 111_195.08;

/**
 * The fastest speed from which a truck can still stop within `remaining`
 * metres, braking at DECEL_MS2 in steps of `dt` seconds.
 *
 * Speed is updated before position each step, so the stopping distance from
 * v is v²/2a + v·dt/2, not the continuous v²/2a. Solving for v gives
 * v = −a·dt/2 + √((a·dt/2)² + 2a·remaining). The first version used the
 * continuous formula and chased the limit with comfortable braking only, so
 * trucks reached the kerb at about 1.4 m/s and were snapped to a halt. The
 * tests caught it.
 */
export function stoppingLimit(remaining: number, dt: number): number {
  const half = (DECEL_MS2 * dt) / 2;
  return Math.sqrt(half * half + 2 * DECEL_MS2 * Math.max(0, remaining)) - half;
}

export class Vehicle {
  path: RoutePath;
  distanceAlong: number;
  speed = 0;
  heading = 0;
  lat = 0;
  lon = 0;
  /** Segment of `path` the truck is on, kept from the last placement so a step needn't search again. */
  segment = 0;
  status: VehicleStatus = "moving";
  statusUntil = 0;
  stopUntil = 0;

  private seq = 0;
  private nextPingAt: number;
  private gapBuffer: Ping[] = [];
  private readonly clockSkewMs: number;
  private readonly driverFactor: number;
  private offUntil = -Infinity;
  private nextOutageAt = Infinity;
  private lastReportAt = -Infinity;

  constructor(
    readonly info: VehicleInfo,
    private readonly motion: Rng,
    private readonly device: Rng,
    private readonly network: RoadNetwork,
    private readonly deviceConfig: DeviceConfig,
    start: number,
    readonly habits: Habits = { speedCapMs: TRUCK_MAX_SPEED_MS },
  ) {
    if (habits.power && deviceConfig.outagesPerHour > 0) this.nextOutageAt = start + this.untilNextOutage(habits.power);
    this.driverFactor = motion.range(0.9, 1.1);
    this.path = motion.pick(network.paths);
    this.distanceAlong = motion.range(0, this.path.length);
    if (motion.chance(0.15)) {
      this.status = "loading";
      this.statusUntil = start + motion.range(0, 40 * 60_000);
    }
    this.clockSkewMs = device.chance(deviceConfig.skewedShare)
      ? device.range(-deviceConfig.maxSkewMs, deviceConfig.maxSkewMs)
      : device.normal(0, deviceConfig.normalSkewSdMs);
    // A random phase, so 5,000 devices don't all report on the same millisecond.
    this.nextPingAt = start + device.range(0, deviceConfig.movingIntervalMs);
    this.place();
  }

  /** Exponential waiting time: outages arrive as a Poisson process at `outagesPerHour`. */
  private untilNextOutage(power: Rng): number {
    return (-Math.log(1 - power.next()) / this.deviceConfig.outagesPerHour) * 3_600_000;
  }

  private place(): void {
    const at = positionAt(this.path, this.distanceAlong);
    this.lat = at.lat;
    this.lon = at.lon;
    this.heading = at.heading;
    this.segment = at.segment;
  }

  /** Advance the truck by `dtMs`, ending at time `now`. */
  drive(now: number, dtMs: number): void {
    const dt = dtMs / 1000;

    if (this.status === "loading") {
      this.speed = 0;
      if (now < this.statusUntil) return;
      const next = this.network.outgoing.get(this.path.to);
      if (!next || next.length === 0) throw new Error(`no route leaves ${this.path.to}`);
      this.path = this.motion.pick(next);
      this.distanceAlong = 0;
      this.status = "moving";
      this.place();
    }

    // Where the last step left the truck. `place()` keeps these current.
    const zone = zoneAt([this.lat, this.lon]);

    if (now >= this.stopUntil) {
      // Poisson arrivals: a chance of dt / mean-gap per step gives stops that
      // come on average every mean-gap seconds, whatever the step size.
      if (zone?.stopAndGo && this.motion.chance(dt / 45)) {
        this.stopUntil = now + this.motion.range(20_000, 90_000);
      } else if (timeOfDayFactor(lagosHour(now)) < 0.7 && this.motion.chance(dt / 600)) {
        this.stopUntil = now + this.motion.range(10_000, 40_000);
      }
    }

    const cruise = now < this.stopUntil ? 0 : targetSpeed(this.path.freeFlow[this.segment]!, now, zone, this.driverFactor, this.habits.speedCapMs);
    // Comfortable acceleration and braking towards the speed the road allows.
    this.speed = this.speed < cruise ? Math.min(cruise, this.speed + ACCEL_MS2 * dt) : Math.max(cruise, this.speed - DECEL_MS2 * dt);
    // Then a hard limit: never faster than can still stop at the destination,
    // braking harder than comfortable if that is what it takes.
    this.speed = Math.min(this.speed, stoppingLimit(this.path.length - this.distanceAlong, dt));
    this.distanceAlong = Math.min(this.path.length, this.distanceAlong + this.speed * dt);
    this.place();

    if (this.path.length - this.distanceAlong < 0.05) {
      this.distanceAlong = this.path.length;
      this.speed = 0;
      this.status = "loading";
      this.statusUntil = now + this.motion.range(10 * 60_000, 40 * 60_000);
    }
  }

  /**
   * The tracker's side: report if a report is due. Returns the pings the device
   * *sends* now. Inside a gap zone that is nothing, and on leaving it that is
   * the whole backlog at once.
   */
  report(now: number, gapZones: readonly GapZone[]): Ping[] {
    this.lastReportAt = now;
    const power = this.habits.power;
    if (power && now >= this.nextOutageAt) {
      this.offUntil = now + power.range(this.deviceConfig.outageMinMs, this.deviceConfig.outageMaxMs);
      this.nextOutageAt = this.offUntil + this.untilNextOutage(power);
    }
    // No power: nothing recorded, nothing sent. Reporting resumes on the normal schedule after.
    if (now < this.offUntil) return [];
    if (now < this.nextPingAt) return [];

    const parked = this.status === "loading";
    const interval = parked ? this.deviceConfig.parkedIntervalMs : this.deviceConfig.movingIntervalMs;
    const jitter = Math.max(-150, Math.min(150, this.device.normal(0, 40)));
    this.nextPingAt += interval + jitter;
    // After a long pause (or a switch from parked to moving) don't fire a burst of catch-up reports.
    if (this.nextPingAt < now) this.nextPingAt = now + interval;

    const sigma = this.deviceConfig.gpsSigmaM;
    const north = this.device.normal(0, sigma);
    const east = this.device.normal(0, sigma);
    const lat = this.lat + north / METRES_PER_DEG_LAT;
    const lon = this.lon + east / (METRES_PER_DEG_LAT * Math.cos((this.lat * Math.PI) / 180));
    const inGap = gapZones.some((zone) => withinRadius([this.lat, this.lon], zone.center, zone.radiusM));

    const ping: Ping = {
      vehicleId: this.info.id,
      seq: this.seq,
      deviceTime: Math.round(now + this.clockSkewMs),
      lat,
      lon,
      speed: parked ? 0 : Math.min(655, Math.max(0, this.speed + this.device.normal(0, 0.2))),
      heading: this.heading,
      flags: (parked ? 0 : PingFlag.Ignition) | (inGap ? PingFlag.Buffered : 0),
    };
    this.seq = (this.seq + 1) >>> 0;

    if (inGap) {
      this.gapBuffer.push(ping);
      return [];
    }
    const sent = [...this.gapBuffer, ping];
    this.gapBuffer = [];
    return sent;
  }

  truth(): Truth {
    return {
      lat: this.lat,
      lon: this.lon,
      speed: this.speed,
      heading: this.heading,
      status: this.status,
      pathId: this.path.id,
      distanceAlong: this.distanceAlong,
      deviceOff: this.lastReportAt < this.offUntil,
    };
  }
}
