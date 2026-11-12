import * as THREE from 'three';

export function createSkyDomeMaterial(
  zenithHex = 0x0b1024,
  horizonHex = 0x1a1528,
  moonColorHex = 0xe8c174,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uZenith: { value: new THREE.Color(zenithHex) },
      uHorizon: { value: new THREE.Color(horizonHex) },
      uMoonColor: { value: new THREE.Color(moonColorHex) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uMoonColor;
      varying vec3 vWorldDir;

      float hash31(vec3 p) {
        p = fract(p * vec3(443.897, 441.423, 437.195));
        p += dot(p, p.yzx + 19.19);
        return fract((p.x + p.y) * p.z);
      }

      void main() {
        vec3 dir = normalize(vWorldDir);
        float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
        float horizonFactor = smoothstep(-0.08, 0.52, dir.y);
        vec3 sky = mix(uHorizon, uZenith, pow(horizonFactor, 0.78));

        // Ethereal astral nebula ribbons across the upper vault
        float wispA = sin(dir.x * 5.0 + dir.z * 3.0 + uTime * 0.08);
        float wispB = cos(dir.y * 8.0 - dir.x * 4.0 - uTime * 0.05);
        float nebula = smoothstep(0.15, 0.95, 0.5 + 0.3 * wispA + 0.25 * wispB) * smoothstep(0.0, 0.45, dir.y);
        sky += uMoonColor * nebula * 0.12;

        // Crisp circular twinkling starfield in the night vault
        vec3 starGrid = dir * 115.0;
        vec3 cell = floor(starGrid);
        vec3 local = fract(starGrid) - 0.5;
        float rnd = hash31(cell);
        if (rnd > 0.965 && dir.y > -0.02) {
          float distFromCenter = length(local);
          float dotMask = smoothstep(0.26, 0.03, distFromCenter);
          float twinkle = 0.6 + 0.4 * sin(uTime * 2.6 + rnd * 120.0);
          float star = dotMask * twinkle * smoothstep(-0.02, 0.22, dir.y);
          sky += mix(vec3(0.8, 0.9, 1.0), uMoonColor, fract(rnd * 37.0)) * star * 1.5;
        }

        // Eclipsed Astral Moon positioned above the northern sanctuary arch
        vec3 moonDir = normalize(vec3(-0.18, 0.38, -0.91));
        float cosTheta = dot(dir, moonDir);
        float outerGlow = pow(max(0.0, cosTheta), 14.0) * 0.42;
        float corona = smoothstep(0.9925, 0.9975, cosTheta) * 1.6;
        float eclipseCore = smoothstep(0.9968, 0.9982, cosTheta);
        float rim = smoothstep(0.9955, 0.9972, cosTheta) - eclipseCore * 0.92;

        sky += uMoonColor * outerGlow;
        sky = mix(sky, vec3(0.03, 0.03, 0.06), eclipseCore * 0.92);
        sky += uMoonColor * max(0.0, rim + corona * 0.45) * 1.35;

        // Horizon mist band
        float mist = exp(-abs(dir.y) * 9.0);
        sky = mix(sky, uHorizon * 1.25, mist * 0.55);

        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
}

export function createSlashArcMaterial(colorHex: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uProgress: { value: 0 },
      uColor: { value: new THREE.Color(colorHex) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uProgress;
      uniform vec3 uColor;
      varying vec2 vUv;

      void main() {
        float trail = smoothstep(0.0, 0.72, vUv.x) * (1.0 - smoothstep(0.75, 1.0, vUv.x));
        float edge = sin(vUv.y * 3.14159);
        float fade = 1.0 - smoothstep(0.25, 1.0, uProgress);
        float core = pow(edge, 1.6) * trail * fade;
        vec3 col = mix(uColor, vec3(1.0, 0.96, 0.85), core * 0.65) * 1.85;
        gl_FragColor = vec4(col, clamp(core * 1.15, 0.0, 1.0));
      }
    `,
  });
}

export function createFogGateMaterial(colorHex: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(colorHex) },
      uIntensity: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec2 vUv;

      void main() {
        float w1 = sin(vUv.y * 10.0 - uTime * 2.4 + sin(vUv.x * 6.0 + uTime));
        float w2 = cos(vUv.x * 12.0 + uTime * 1.7 - vUv.y * 7.0);
        float swirl = sin(length(vUv - vec2(0.5)) * 14.0 - uTime * 3.0) * 0.18;
        float mist = 0.55 + 0.25 * w1 + 0.22 * w2 + swirl;
        float edgeX = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x);
        float edgeY = smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
        float alpha = clamp(mist * edgeX * edgeY * 0.85 * uIntensity, 0.0, 1.0);
        vec3 col = mix(uColor * 1.25, vec3(1.0, 0.88, 0.62), smoothstep(0.6, 1.0, mist) * 0.55);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

export function createWardShellMaterial(colorHex: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(colorHex) },
      uPulse: { value: 0.5 },
      uOpacity: { value: 0.9 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uPulse;
      uniform float uOpacity;
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;
      varying vec2 vUv;

      void main() {
        vec3 n = normalize(vWorldNormal);
        vec3 v = normalize(vViewDir);
        float fresnel = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), 2.1);
        float lattice = 0.5 + 0.5 * sin(vUv.y * 32.0 - uTime * 3.8) * cos(vUv.x * 20.0 + uTime * 2.2);
        float alpha = clamp((fresnel * 0.92 + lattice * 0.28 * uPulse) * uOpacity, 0.0, 0.96);
        vec3 col = uColor * (1.05 + 0.7 * uPulse) + vec3(1.0, 0.88, 0.62) * fresnel * 0.45;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}
