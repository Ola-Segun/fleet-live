import { SAMPLES_PER_VEHICLE, TEXELS_PER_VEHICLE, VEHICLES_PER_ROW } from "./layout";
import { MODE_CODES } from "./reference";

/*
 * One instanced draw for the whole fleet. Instance i is vehicle slot i; its
 * data is fetched from the sample texture with texelFetch. The only vertex
 * attribute is the quad's corner.
 *
 * The position logic mirrors `gpuEstimate()` in reference.ts line for line.
 * Change one, change the other: the correspondence test holds the TypeScript
 * version to Layer 4's `estimate()`.
 */
export const VEHICLE_VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

layout(location = 0) in vec2 a_corner;   // quad corner in [-1, 1]

uniform sampler2D u_samples;
uniform mat4 u_matrix;                    // MapLibre's matrix with the RTC origin folded in (float64 on the CPU)
uniform float u_time;                     // display time, seconds since the session epoch
uniform vec2 u_viewport;                  // drawing buffer size, px
uniform float u_size;                     // icon size, px
uniform float u_bearing;                  // map bearing, radians
uniform float u_extrapolate;              // seconds a moving truck is projected
uniform float u_movingStale;
uniform float u_parkedStale;
uniform int u_modeMask;                   // bit per mode code: a clear bit hides the truck (status filter)
uniform int u_selected;                   // the selected slot, or -1
uniform int u_pass;                       // 0: every truck except the selected one; 1: only the selected one, drawn on top

out vec2 v_local;
flat out int v_mode;
flat out int v_selected;

const int SAMPLES = ${SAMPLES_PER_VEHICLE};
const int TEXELS = ${TEXELS_PER_VEHICLE};
const int PER_ROW = ${VEHICLES_PER_ROW};

vec4 texel(int slot, int k) {
  return texelFetch(u_samples, ivec2((slot % PER_ROW) * TEXELS + k, slot / PER_ROW), 0);
}

float lerpHeading(float a, float b, float u) {
  float delta = mod(b - a + 540.0, 360.0) - 180.0;
  return mod(a + delta * u, 360.0);
}

void main() {
  int slot = gl_InstanceID;
  if ((u_pass == 1) != (slot == u_selected)) {  // not this pass's truck
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 meta = texel(slot, SAMPLES);
  if (meta.w < 1.0) {                      // no samples yet: put it outside the clip volume
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec4 first = texel(slot, 0);
  vec4 last = texel(slot, SAMPLES - 1);
  vec2 pos;
  float heading;
  int mode;

  if (u_time < first.z) {
    pos = first.xy; heading = first.w; mode = ${MODE_CODES.waiting};
  } else {
    mode = -1;
    if (u_time < last.z) {
      for (int k = 0; k < SAMPLES - 1; k++) {
        vec4 a = texel(slot, k);
        vec4 b = texel(slot, k + 1);
        if (u_time >= a.z && u_time < b.z) {
          float u = (u_time - a.z) / max(b.z - a.z, 1e-6);
          pos = a.xy + (b.xy - a.xy) * u;
          heading = lerpHeading(a.w, b.w, u);
          mode = ${MODE_CODES.interpolated};
          break;
        }
      }
    }
    if (mode < 0) {
      float age = u_time - last.z;
      heading = last.w;
      if (meta.z == 1.0) {
        pos = last.xy;
        mode = age > u_parkedStale ? ${MODE_CODES.stale} : ${MODE_CODES.parked};
      } else {
        pos = last.xy + meta.xy * min(age, u_extrapolate);
        mode = age > u_movingStale ? ${MODE_CODES.stale} : age > u_extrapolate ? ${MODE_CODES.holding} : ${MODE_CODES.extrapolated};
      }
    }
  }

  if (((u_modeMask >> mode) & 1) == 0) {  // filtered out: skip it entirely
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  bool selected = slot == u_selected;
  vec4 clip = u_matrix * vec4(pos, 0.0, 1.0);
  // Rotate the icon so "up" points along the heading. Headings are clockwise from
  // north, screen y is up, and the map may itself be rotated by its bearing.
  float angle = radians(heading) - u_bearing;
  vec2 corner = vec2(a_corner.x * cos(angle) + a_corner.y * sin(angle), -a_corner.x * sin(angle) + a_corner.y * cos(angle));
  float size = selected ? max(u_size, 12.0) * 1.9 : u_size;
  clip.xy += corner * size / u_viewport * clip.w;  // size in px: 2·(size/2)/viewport in clip units
  gl_Position = clip;
  v_local = a_corner;
  v_mode = mode;
  v_selected = selected ? 1 : 0;
}
`;

export const VEHICLE_FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

in vec2 v_local;
flat in int v_mode;
flat in int v_selected;
uniform float u_detail;                   // 0 at low zoom: every truck a plain dot
out vec4 outColor;

// Signed distances in the quad's local space, [-1, 1]. Negative is inside.
float circle(vec2 p, float r) { return length(p) - r; }
float arrow(vec2 p) {
  // A chevron pointing up (+y): an isosceles triangle with a notch cut from its base.
  vec2 q = vec2(abs(p.x), p.y);
  float edge = dot(q - vec2(0.0, 0.9), normalize(vec2(0.9, 0.55)));
  float base = -p.y - 0.75;
  float notch = -(dot(q - vec2(0.0, -0.25), normalize(vec2(-0.6, 1.0))));
  return max(max(edge, base), notch);
}

void main() {
  vec3 color;
  float d;
  bool outline = true;
  if (v_selected == 1) {
    // Selected: a dark ring around the truck's own shape, legible at any zoom.
    float shape = (v_mode == ${MODE_CODES.parked} || v_mode == ${MODE_CODES.stale}) ? circle(v_local, 0.32) : arrow(v_local * 1.7);
    float ring = abs(circle(v_local, 0.8)) - 0.09;
    d = min(shape, ring);
    color = vec3(0.07, 0.09, 0.15);
  } else if (u_detail < 0.5) {
    d = circle(v_local, 0.8);
    color = v_mode == ${MODE_CODES.parked} ? vec3(0.42, 0.45, 0.50) : v_mode == ${MODE_CODES.stale} ? vec3(0.86, 0.15, 0.15) : vec3(0.15, 0.39, 0.92);
    outline = false;
  } else if (v_mode == ${MODE_CODES.interpolated}) {
    d = arrow(v_local); color = vec3(0.15, 0.39, 0.92);            // moving: blue arrow
  } else if (v_mode == ${MODE_CODES.extrapolated} || v_mode == ${MODE_CODES.holding}) {
    d = arrow(v_local); color = vec3(0.85, 0.47, 0.02);            // projected past the newest report: amber arrow
  } else if (v_mode == ${MODE_CODES.parked}) {
    d = circle(v_local, 0.5); color = vec3(0.42, 0.45, 0.50);     // parked: grey dot
  } else if (v_mode == ${MODE_CODES.stale}) {
    d = abs(circle(v_local, 0.6)) - 0.18; color = vec3(0.86, 0.15, 0.15); // stale: red hollow ring
  } else {
    d = circle(v_local, 0.3); color = vec3(0.61, 0.64, 0.69);     // waiting: small dot
  }
  float aa = fwidth(d);
  float fill = clamp(0.5 - d / aa, 0.0, 1.0);
  // A white halo just outside the shape keeps it legible on any basemap colour.
  float halo = outline ? clamp(0.5 - (d - 0.18) / aa, 0.0, 1.0) : 0.0;
  vec3 rgb = mix(vec3(1.0), color, fill);
  float alpha = max(fill, halo);
  if (alpha <= 0.0) discard;
  outColor = vec4(rgb * alpha, alpha);   // premultiplied, as MapLibre blends
}
`;
