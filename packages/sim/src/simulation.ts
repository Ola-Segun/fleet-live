import { FrameType, type Frame } from "@fleet/protocol";
import { ChaosChannel, DEFAULT_CHAOS, type ChaosConfig, type ChaosStats } from "./chaos";
import { makeDriverName, makePlate } from "./identity";
import { positionAt, type RoadNetwork } from "./network";
import { createRng, type Rng } from "./random";
import { DEFAULT_DEVICE, Vehicle, type DeviceConfig, type GapZone, type Truth, type VehicleInfo } from "./vehicle";

export interface SimConfig {
  seed: number | string;
  vehicleCount: number;
  /** Integer epoch ms. The time of day matters: it sets the traffic. */
  startTime: number;
  /** Physics step. Smaller is smoother and costs more. */
  stepMs?: number;
  /** How often the server sends a frame of whatever has arrived. */
  frameIntervalMs?: number;
  chaos?: Partial<ChaosConfig>;
  device?: Partial<DeviceConfig>;
}

/**
 * A whole fleet, its trackers and the network between them, advanced in fixed
 * steps of simulated time. It never reads the wall clock, so it runs as fast
 * as the CPU allows in a test and in real time only when a caller paces it.
 *
 * Randomness is split into named streams (see random.ts):
 *   vehicle:<id>:motion    how that truck drives and which routes it picks
 *   vehicle:<id>:device    its GPS noise, clock skew and report timing
 *   vehicle:<id>:identity  its plate and driver
 *   zones                  where the coverage gaps are
 *   chaos                  what the network does
 * so changing one concern never changes another.
 */
export class Simulation {
  readonly vehicles: Vehicle[];
  readonly gapZones: GapZone[];
  readonly stepMs: number;
  readonly frameIntervalMs: number;
  private readonly channel: ChaosChannel;
  private readonly root: Rng;
  private clock: number;
  private nextFrameAt: number;
  private frameSeq = 0;

  constructor(network: RoadNetwork, config: SimConfig) {
    if (!Number.isInteger(config.startTime)) throw new RangeError("startTime must be integer epoch ms");
    this.stepMs = config.stepMs ?? 100;
    this.frameIntervalMs = config.frameIntervalMs ?? 100;
    if (this.frameIntervalMs % this.stepMs !== 0) {
      throw new RangeError("frameIntervalMs must be a whole number of steps, so frames land on step boundaries");
    }
    this.root = createRng(config.seed);
    this.clock = config.startTime;
    this.nextFrameAt = config.startTime + this.frameIntervalMs;

    const device = { ...DEFAULT_DEVICE, ...config.device };
    const zones = this.root.fork("zones");
    this.gapZones = Array.from({ length: device.gapZoneCount }, () => {
      const path = zones.pick(network.paths);
      const at = positionAt(path, zones.range(0, path.length));
      return { center: [at.lat, at.lon] as const, radiusM: device.gapZoneRadiusM };
    });

    const plates = new Set<string>();
    this.vehicles = Array.from({ length: config.vehicleCount }, (_, id) => {
      const identity = this.root.fork(`vehicle:${id}:identity`);
      let plate = makePlate(identity);
      // Rare, but two invented plates can collide. Draw again from the same stream.
      while (plates.has(plate)) plate = makePlate(identity);
      plates.add(plate);
      const info: VehicleInfo = { id, plate, driver: makeDriverName(identity) };
      return new Vehicle(
        info,
        this.root.fork(`vehicle:${id}:motion`),
        this.root.fork(`vehicle:${id}:device`),
        network,
        device,
        config.startTime,
      );
    });

    this.channel = new ChaosChannel({ ...DEFAULT_CHAOS, ...config.chaos }, this.root.fork("chaos"));
  }

  get now(): number {
    return this.clock;
  }

  get networkStats(): Readonly<ChaosStats> {
    return this.channel.stats;
  }

  /** Run `ms` of simulated time. Returns the frames the server would have sent, in order. */
  advance(ms: number): Frame[] {
    const frames: Frame[] = [];
    const end = this.clock + ms;
    while (this.clock + this.stepMs <= end) {
      this.clock += this.stepMs;
      for (const vehicle of this.vehicles) {
        vehicle.drive(this.clock, this.stepMs);
        for (const ping of vehicle.report(this.clock, this.gapZones)) this.channel.send(ping, this.clock);
      }
      if (this.clock >= this.nextFrameAt) {
        // Frames go out even when empty: a steady 10 Hz is how a client tells
        // "no trucks moved" from "the connection is dead".
        frames.push({
          type: FrameType.Delta,
          frameSeq: this.frameSeq,
          baseTime: this.clock,
          pings: this.channel.receive(this.clock),
        });
        this.frameSeq = (this.frameSeq + 1) >>> 0;
        this.nextFrameAt += this.frameIntervalMs;
      }
    }
    return frames;
  }

  truth(vehicleId: number): Truth {
    const vehicle = this.vehicles[vehicleId];
    if (!vehicle) throw new RangeError(`no vehicle ${vehicleId}`);
    return vehicle.truth();
  }

  info(): VehicleInfo[] {
    return this.vehicles.map((v) => v.info);
  }
}
