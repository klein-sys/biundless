import * as THREE from 'three';

export function createSkyDomeMaterial(
  zenithHex = 0x2674de,
  horizonHex = 0xc5ecff,
  sunColorHex = 0xfff3c6,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uZenith: { value: new THREE.Color(zenithHex) },
      uHorizon: { value: new THREE.Color(horizonHex) },
      uSunColor: { value: new THREE.Color(sunColorHex) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vWorldDir = normalize(position);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uSunColor;
      varying vec3 vWorldDir;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise2D(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      float fbmClouds(vec2 p) {
        float v = 0.0;
        float amp = 0.5;
        for (int i = 0; i < 4; i++) {
          v += amp * noise2D(p);
          p = p * 2.07 + vec2(17.1, 31.7);
          amp *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 dir = normalize(vWorldDir);
        float up = clamp(dir.y, -0.2, 1.0);
        float horizonFactor = smoothstep(-0.04, 0.58, up);
        vec3 midSky = mix(uHorizon, uZenith, 0.42);
        vec3 sky = mix(uHorizon, midSky, smoothstep(0.0, 0.25, horizonFactor));
        sky = mix(sky, uZenith, pow(horizonFactor, 0.85));

        // Radiant sun & atmospheric corona
        vec3 sunDir = normalize(vec3(0.42, 0.54, -0.73));
        float cosSun = max(0.0, dot(dir, sunDir));
        float sunGlowWide = pow(cosSun, 6.0) * 0.28;
        float sunGlowTight = pow(cosSun, 48.0) * 0.65;
        float sunDisc = smoothstep(0.9965, 0.9985, cosSun) * 1.45;
        sky += uSunColor * (sunGlowWide + sunGlowTight + sunDisc);

        // Soft drifting BotW/Genshin-style sunlit cumulus clouds
        if (dir.y > 0.02) {
          vec2 cloudUv = dir.xz / (dir.y + 0.19) * 1.15;
          cloudUv += vec2(uTime * 0.016, uTime * 0.008);
          float n = fbmClouds(cloudUv);
          float nDetail = fbmClouds(cloudUv * 2.3 - vec2(uTime * 0.01, 0.0));
          float density = smoothstep(0.50, 0.78, n * 0.75 + nDetail * 0.28);
          float cloudFade = smoothstep(0.02, 0.18, dir.y) * (1.0 - smoothstep(0.68, 0.96, dir.y));
          float cloudMask = density * cloudFade * 0.88;

          // Sunlit cream tops, gentle periwinkle undersides
          vec3 cloudShadow = mix(vec3(0.76, 0.85, 0.96), uHorizon, 0.35);
          vec3 cloudLit = mix(vec3(0.99, 0.99, 0.97), uSunColor, 0.22 + 0.3 * pow(cosSun, 4.0));
          vec3 cloudCol = mix(cloudShadow, cloudLit, smoothstep(0.35, 0.78, n));
          sky = mix(sky, cloudCol, cloudMask);
        }

        // Soft sunlit atmospheric horizon haze
        float mist = exp(-abs(dir.y) * 9.5);
        sky = mix(sky, mix(uHorizon, vec3(0.93, 0.97, 1.0), 0.35), mist * 0.65);

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
    blending: THREE.NormalBlending,
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
        float trail = smoothstep(0.0, 0.65, vUv.x) * (1.0 - smoothstep(0.72, 1.0, vUv.x));
        float edge = sin(vUv.y * 3.14159);
        float fade = 1.0 - smoothstep(0.28, 1.0, uProgress);
        float core = pow(edge, 1.35) * trail * fade;
        vec3 col = mix(uColor * 1.15, vec3(1.0, 0.99, 0.92), smoothstep(0.45, 0.95, core));
        gl_FragColor = vec4(col, clamp(core * 1.35, 0.0, 0.96));
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
        float alpha = clamp(mist * edgeX * edgeY * 0.78 * uIntensity, 0.0, 1.0);
        vec3 col = mix(uColor * 1.2, vec3(1.0, 0.95, 0.78), smoothstep(0.6, 1.0, mist) * 0.55);
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
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(colorHex) },
      uPulse: { value: 0.5 },
      uOpacity: { value: 0.75 },
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
        float fresnel = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), 1.9);
        float lattice = 0.5 + 0.5 * sin(vUv.y * 32.0 - uTime * 3.8) * cos(vUv.x * 20.0 + uTime * 2.2);
        float alpha = clamp((fresnel * 0.85 + lattice * 0.24 * uPulse) * uOpacity, 0.0, 0.88);
        vec3 col = mix(uColor, vec3(1.0, 0.96, 0.84), fresnel * 0.45) * (0.95 + 0.35 * uPulse);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

export function createWaterStreamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
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
      varying vec2 vUv;

      void main() {
        float flow = sin(vUv.x * 26.0 - uTime * 3.2 + sin(vUv.y * 10.0) * 1.5);
        float shimmer = smoothstep(0.45, 0.95, 0.5 + 0.5 * flow);
        float edge = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.84, vUv.y);
        vec3 deep = vec3(0.18, 0.62, 0.82);
        vec3 foam = vec3(0.86, 0.97, 1.0);
        vec3 col = mix(deep, foam, shimmer * 0.48 + (1.0 - edge) * 0.25);
        gl_FragColor = vec4(col, edge * 0.84);
      }
    `,
  });
}
