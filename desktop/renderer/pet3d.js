// 3D 渲染层：Three.js WebGL 渲染官方猫糕模型（cake.glb + skinNN.png 皮肤）
// cake.glb/皮肤加载失败或 WebGL 不可用时回退 2D webp 模式
// 架构：canvas 铺满整个窗口（无 #app 反向平移/缩放坐标链），相机把静态包络 fit 进视野，
// 窗口尺寸 = 包络宽高比 × petSize，换猫/改档时设一次后冻结（动作/旋转/待机不变）
// 通过 window.pet3d 对外暴露：ready / available / setCake / play / glow / hitTest / setGlowColor
import * as THREE from 'three';
import { GLTFLoader } from './vendor/three/loaders/GLTFLoader.js';
import { clone as skeletonClone } from './vendor/three/utils/SkeletonUtils.js';

(function () {
  console.time('[pet3d] 启动→首帧');
  const stage = document.getElementById('stage');
  const img = document.getElementById('cake');
  const edgeGlow = document.getElementById('edgeGlow');
  const shadow = document.getElementById('shadow');
  const bubbleEl = document.getElementById('bubble');
  const appEl = document.getElementById('app');

  const TARGET_H = 2;      // 模型归一化后的世界高度
  const FLOAT_AMP_PX = 7;  // 常驻浮动幅度（等效 px，对齐 CSS float）
  const FLOAT_PERIOD = 3.2;
  const VIEW_MARGIN = 0.06; // 相机取景四周边距（包络占视野 88%）
  // 静态包络常数余量：动作挤压/歪头/跳跃/float/地面影子（px 量按 petSize 档换算成世界单位）
  const SQUASH_X = 1.22;   // 横向：duang 最大横向挤压
  const SQUASH_Y = 1.14;   // 纵向：duang 最大拉高
  const TILT_RAD = 14 * Math.PI / 180; // 歪头最大角度
  const JUMP_PX = 34;      // act-spin 腾空高度
  const SIDE_PX = 6;       // 横向漂移余量
  const SHADOW_PX = 12;    // 底部地面 DOM 影子余量

  let renderer = null;
  let available = false;
  let webglOk = false;    // WebGL 上下文创建成功且未丢失
  let fault2D = false;    // 故障兜底标志（上下文丢失/模型加载失败），与用户开关无关
  let userMode = '3d';    // 用户显示模式开关（renderMode 配置）：'3d' | '2d'
  let animFrozen = false; // 动画冻结（截图工具用）：dt=0 + 停正弦浮动/程序化动作，渲染照常
  // 有效 available = WebGL 正常 && 无故障 && 用户选了 3D（2D 时 hitTest/play 等自然走 2D 分流）
  function syncAvailable() { available = webglOk && !fault2D && userMode === '3d'; }
  let scene, camera, canvas;
  let PX = 0.01;           // 1 css px 对应的世界单位（由取景框算出）
  const modelRoot = new THREE.Group(); // 动作变换挂点
  const viewGroup = new THREE.Group(); // 观看角度挂点（Shift+拖动旋转），与动作动画分层互不干扰
  const raycaster = new THREE.Raycaster();
  const modelCache = new Map(); // id -> Promise<{holder, clips}>
  let currentEntry = null;
  let mixer = null;              // 模型自带剪辑时启用
  let curAction = null;          // { def, start, onDone }
  let rafId = 0;
  let lastT = 0;
  let glowMat = null;
  let glowUntil = 0;
  let glowAlpha = 0;
  let glowColorName = 'rainbow';
  let cakeToken = 0;

  const D2R = Math.PI / 180;
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

  // ---- 动作关键帧：语义对齐 index.html 里的 CSS @keyframes ----
  // sx/sy 缩放（sz 缺省跟随 sx）；rz/ry 角度（度）；py 位移（px，向上为正）
  const ACTIONS3D = {
    // 果冻 Q 弹 duang
    'act-duang': { dur: 0.65, t: {
      sx: [[0, 1], [0.25, 1.22], [0.45, 0.88], [0.62, 1.08], [0.78, 0.97], [1, 1]],
      sy: [[0, 1], [0.25, 0.78], [0.45, 1.14], [0.62, 0.93], [0.78, 1.03], [1, 1]],
    } },
    // 扭动身子
    'act-wiggle': { dur: 0.7, t: {
      rz: [[0, 0], [0.2, -9], [0.4, 8], [0.6, -6], [0.8, 3], [1, 0]],
      sx: [[0, 1], [0.2, 1.05], [0.4, 0.96], [0.6, 1.03], [1, 1]],
      sy: [[0, 1], [0.2, 0.95], [0.4, 1.04], [0.6, 0.97], [1, 1]],
    } },
    // 跳起来空中转一圈再落地
    'act-spin': { dur: 0.95, t: {
      py: [[0, 0], [0.15, -3], [0.35, 34], [0.55, 34], [0.75, -1], [1, 0]],
      ry: [[0, 0], [0.35, 170], [0.55, 360], [1, 360]],
      sx: [[0, 1], [0.15, 1.15], [0.35, 0.8], [0.55, 0.8], [0.75, 1.1], [1, 1]],
      sy: [[0, 1], [0.15, 0.85], [0.35, 0.8], [0.55, 0.8], [0.75, 0.9], [1, 1]],
    } },
    // 开心跳一下
    'act-hop': { dur: 0.6, t: {
      py: [[0, 0], [0.25, -4], [0.55, 26], [0.8, -2], [1, 0]],
      sx: [[0, 1], [0.25, 1.15], [0.55, 0.92], [0.8, 1.06], [1, 1]],
      sy: [[0, 1], [0.25, 0.85], [0.55, 1.08], [0.8, 0.94], [1, 1]],
    } },
    // act-hop 的官方剪辑叠加层：只给腾空弧线不带挤压（挤压由 Jump/Landing 骨骼动画负责，
    // 双层挤压会「像海绵」）；时长对齐 Jump(1.57s)+Landing(0.80s) 连播
    'hop-lift': { dur: 2.37, t: {
      py: [[0, 0], [0.08, -3], [0.28, 34], [0.55, 30], [0.75, -2], [1, 0]],
    } },
    // 疑惑歪头
    'act-tilt': { dur: 1, t: {
      rz: [[0, 0], [0.3, -14], [0.65, -14], [1, 0]],
    } },
    // 待机：伸懒腰
    'idle-stretch': { dur: 2.4, t: {
      sx: [[0, 1], [0.3, 0.96], [0.55, 0.96], [1, 1]],
      sy: [[0, 1], [0.3, 1.09], [0.55, 1.09], [1, 1]],
    } },
    // 待机：轻轻摇晃
    'idle-sway': { dur: 2.8, t: {
      rz: [[0, 0], [0.25, 2.5], [0.75, -2.5], [1, 0]],
    } },
    // 待机：左右看看（3D 里用转脸）
    'idle-look': { dur: 2.6, t: {
      ry: [[0, 0], [0.25, -26], [0.5, -26], [0.75, 26], [1, 0]],
    } },
    // 待机：蜷缩打盹
    'idle-curl': { dur: 2.8, t: {
      sx: [[0, 1], [0.35, 0.94], [0.65, 0.94], [1, 1]],
      sy: [[0, 1], [0.35, 0.9], [0.65, 0.9], [1, 1]],
    } },
  };

  function sampleTrack(track, t) {
    if (t <= track[0][0]) return track[0][1];
    for (let i = 1; i < track.length; i++) {
      if (t <= track[i][0]) {
        const t0 = track[i - 1][0], v0 = track[i - 1][1];
        const t1 = track[i][0], v1 = track[i][1];
        return v0 + (v1 - v0) * easeInOut((t - t0) / (t1 - t0));
      }
    }
    return track[track.length - 1][1];
  }

  // ---- 轮廓流光：Fresnel 边缘发光壳（BackSide 微放大 + additive，支持蒙皮） ----
  const GLOW3D = {
    rainbow: { color: 0xffffff, rainbow: 1 },
    gold: { color: 0xffd54f, rainbow: 0 },
    pink: { color: 0xff8fb3, rainbow: 0 },
    ice: { color: 0x7fd8ff, rainbow: 0 },
    purple: { color: 0xb39dff, rainbow: 0 },
  };

  // 蒙皮壳共用顶点 shader 头：three 内建 skinning chunks，骨骼由 renderer 自动注入
  const SKIN_VERT_HEAD = `
    #include <common>
    #include <skinning_pars_vertex>
  `;
  const SKIN_VERT_BODY = `
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
  `;

  function makeGlowMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xffffff) },
        uAlpha: { value: 0 },
        uHue: { value: 0 },
        uRainbow: { value: 1 },
      },
      vertexShader: SKIN_VERT_HEAD + `
        varying float vFresnel;
        void main() {
          ${SKIN_VERT_BODY}
          vec3 pos = transformed + normalize(objectNormal) * 0.04; // 沿法线外扩一圈
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          vec3 n = normalize(normalMatrix * objectNormal);
          vec3 v = normalize(-mv.xyz);
          vFresnel = pow(1.0 - abs(dot(n, v)), 1.8);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uAlpha;
        uniform float uHue;
        uniform float uRainbow;
        varying float vFresnel;
        vec3 hsl2rgb(vec3 c) {
          vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
          return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
        }
        void main() {
          vec3 col = uRainbow > 0.5
            ? hsl2rgb(vec3(fract(uHue), 0.8, 0.68))
            : uColor;
          // AdditiveBlending 是 SrcAlpha*src + dst：alpha 必须跟随发光强度，
          // 否则 alpha 恒 1 的壳会在透明窗口上留下黑色剪影边
          gl_FragColor = vec4(col, vFresnel * uAlpha);
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  // 给模型每个 mesh 套壳（作为子节点跟随变换；壳不参与命中检测）
  // 注意先收集再添加：traverse 过程中加子节点会被继续遍历到，导致壳套壳死循环
  // SkinnedMesh 的壳也用 SkinnedMesh 并 bind 同一骨架，蒙皮结果与本体一致
  function addShells(obj, material, renderOrder, name) {
    const meshes = [];
    // 跳过隐藏网格（未佩戴的配件）：壳不读 visible，不跳过会渲染出「幽灵配件」
    obj.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh) && o.visible && !o.name.endsWith('Shell')) meshes.push(o); });
    for (const o of meshes) {
      let shell;
      if (o.isSkinnedMesh) {
        shell = new THREE.SkinnedMesh(o.geometry, material);
        shell.bind(o.skeleton, o.bindMatrix);
      } else {
        shell = new THREE.Mesh(o.geometry, material);
      }
      shell.name = name;
      shell.raycast = function () {};
      shell.renderOrder = renderOrder || 0;
      // 作为同级 sibling 并拷贝本体变换：SkinnedMesh 蒙皮要用完全相同的 modelMatrix，
      // 挂成 child 会多乘一层本体节点变换导致壳错位/放大
      o.parent.add(shell);
      shell.position.copy(o.position);
      shell.quaternion.copy(o.quaternion);
      shell.scale.copy(o.scale);
    }
  }

  function addGlowShells(obj) {
    addShells(obj, glowMat, 1, 'glowShell');
  }

  // ---- 官方卡通渲染复刻（参数见 tools/reference/official-rendering.md）----
  // 干净两档卡通：albedo 贴图 + NdotL 0.5 硬阶跃（feather 0.01）+ 暗部乘变体 shadowColor；
  // 不加 Blinn 高光/Fresnel 边缘光（会把眼球凸面洗白，游戏里也没有）
  const DEFAULT_VARIANT = { shadowColor: [0.85, 0.82, 0.85], rimColor: [0.45, 0.45, 0.5], outlineColor: [0.2, 0, 0.02] };
  // 主光带角度：让两档阴影真正塑造体积感（游戏内观感）；贴脸光会整只平掉发白
  const TOON_LIGHT_DIR = new THREE.Vector3(0.55, 0.75, 0.5).normalize();

  // ---- 用户调色（settings 页滑块实时改）：浓郁度=饱和度，深度=中间调 gamma ----
  let gradeSat = 1.25, gradeGamma = 1.22;
  const toonMats = []; // 所有 toon 材质实例，调色时统一更新 uniforms
  function applyGrade() {
    for (const m of toonMats) {
      m.uniforms.uSat.value = gradeSat;
      m.uniforms.uGamma.value = gradeGamma;
    }
  }

  function makeToonMaterial(tex, vp) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: tex },
        shadowColor: { value: new THREE.Vector3().fromArray(vp.shadowColor) },
        lightDir: { value: TOON_LIGHT_DIR },
        uSat: { value: gradeSat },
        uGamma: { value: gradeGamma },
      },
      vertexShader: SKIN_VERT_HEAD + `
        varying vec2 vUv;
        varying vec3 vNormalW;
        void main() {
          vUv = uv;
          ${SKIN_VERT_BODY}
          vNormalW = normalize(mat3(modelMatrix) * objectNormal);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(transformed, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        uniform vec3 shadowColor;
        uniform vec3 lightDir;
        uniform float uSat;
        uniform float uGamma;
        varying vec2 vUv;
        varying vec3 vNormalW;
        void main() {
          vec3 albedo = texture2D(map, vUv).rgb;
          vec3 N = normalize(vNormalW);
          #ifdef DOUBLE_SIDED
            N *= gl_FrontFacing ? 1.0 : -1.0; // 双面渲染时背面翻法线，否则阶跃阴影算反
          #endif
          float toon = smoothstep(0.49, 0.51, dot(N, normalize(lightDir)));
          // gamma 空间乘法（Unity 语义）：亮部=原贴图值直接显示
          vec3 col = albedo * mix(shadowColor, vec3(1.0), toon);
          // 用户调色：浓郁度=饱和度 uSat，深度=中间调 gamma uGamma
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(lum), col, uSat);
          col = pow(col, vec3(uGamma));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.DoubleSide, // 官方 _CullMode 0
    });
    toonMats.push(mat);
    return mat;
  }

  // 官方描边：inverted hull，BackSide 沿法线外扩，每变体 outlineColor，常时显示
  // 用 MeshBasicMaterial + onBeforeCompile 注入外扩（内建材质蒙皮管线最稳）
  function makeOutlineMaterial(vp) {
    const mat = new THREE.MeshBasicMaterial({
      // 用户反馈官方暗红棕 rgb(50,0,5) 在深色壳上显脏：统一压成近黑深紫 #1a0a14
      // （2.0 webp 那种「有边但不抢戏」）；setRGB 带 SRGBColorSpace 保证显示原色
      color: new THREE.Color().setRGB(0x1a / 255, 0x0a / 255, 0x14 / 255, THREE.SRGBColorSpace),
      side: THREE.BackSide,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uOutlineWidth = { value: 0.015 }; // 世界单位（0.03 太重，减半）
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uOutlineWidth;')
        .replace('#include <begin_vertex>',
          // 顶点/法线是蒙皮前局部单位（模型带 403 倍缩放链），外扩量要按 modelMatrix 缩放换算成局部单位
          `#include <begin_vertex>
          {
            float outlineScale = length(modelMatrix[0].xyz);
            transformed += normalize(objectNormal) * (uOutlineWidth / outlineScale);
          }`);
    };
    return mat;
  }

  function addOutlineShells(obj, vp) {
    addShells(obj, makeOutlineMaterial(vp), -1, 'outlineShell'); // 先画描边再画本体
  }

  // 每变体渲染参数（skinparams.json，走 cake:// 协议 fetch）
  let skinParamsP = null;
  function loadSkinParams() {
    if (!skinParamsP) {
      skinParamsP = fetch('cake://models/skinparams.json')
        .then((r) => r.json())
        .catch((e) => { console.warn('[pet3d] skinparams.json 加载失败，用默认参数', e); return null; });
    }
    return skinParamsP;
  }


  // 模型归一化：按 bind 几何包围盒缩放到固定高度、水平居中、底部贴 y=0
  //（GLTF 几何是米制但节点链带 1/403 缩放，bind bbox≈0.005，归一化 ×~403 后模型约 TARGET_H 高）
  // 完整 art prefab 带配件（帽子等）会撑大包围盒把身体压小：优先按 Body 网格归一化，找不到再整体
  function normalizeModel(obj) {
    const holder = new THREE.Group();
    holder.add(obj);
    let body = null;
    obj.traverse((o) => { if (!body && (o.isMesh || o.isSkinnedMesh) && /body/i.test(o.name)) body = o; });
    const box = new THREE.Box3().setFromObject(body || holder);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y);
    if (maxDim > 0) obj.scale.multiplyScalar(TARGET_H / maxDim);
    const box2 = new THREE.Box3().setFromObject(body || holder);
    const c = box2.getCenter(new THREE.Vector3());
    obj.position.x -= c.x;
    obj.position.z -= c.z;
    obj.position.y -= box2.min.y;
    return holder;
  }

  // ---- 官方模型：基础模型只加载一次，每只猫克隆骨架实例 + 换皮肤贴图 ----
  // 完整 art prefab（cake-full.glb：Face 网格 + 配件 + 完整骨架，解包资产到齐后放入 models/）
  // 存在时优先使用；缺席时回退 cake.glb（仅身体），行为与之前完全一致
  const gltfLoader = new GLTFLoader();
  const texLoader = new THREE.TextureLoader();
  let baseModelP = null;
  const skinTexCache = new Map(); // n -> Promise<Texture>

  function loadBaseModel() {
    if (!baseModelP) {
      // 走 cake:// 自定义协议（file:// 下 fetch 本地文件被 Chromium 拦）
      console.time('[pet3d] 模型加载');
      baseModelP = gltfLoader.loadAsync('cake://models/cake-full.glb')
        .then((gltf) => {
          console.log('[pet3d] 完整模型 cake-full.glb 加载成功（art prefab：Face/配件/完整骨架）');
          return gltf;
        })
        .catch(() => gltfLoader.loadAsync('cake://models/cake.glb').then((gltf) => {
          console.log('[pet3d] 基础模型 cake.glb 加载成功（无 cake-full.glb）');
          return gltf;
        }))
        .then((gltf) => { console.timeEnd('[pet3d] 模型加载'); return gltf; });
    }
    return baseModelP;
  }

  function loadSkinTex(n) {
    const key = String(n).padStart(2, '0');
    if (!skinTexCache.has(key)) {
      // <img> 加载走相对路径即可（file:// 同目录图片不受限）
      // 扩展名可注入：桌面端用原 PNG，手机端包体积敏感用 webp q95（PET3D_SKIN_EXT，见 mobile/assets/pet3d/）
      const ext = window.PET3D_SKIN_EXT || 'png';
      skinTexCache.set(key, texLoader.loadAsync(`models/skin${key}.${ext}`).then((tex) => {
        tex.flipY = false; // GLTF UV 规范
        // 全 gamma 管线：贴图不做 sRGB 解码，shader 里直接乘算原值输出，
        // 和 Unity gamma 空间语义一致（线性空间乘暗部会发闷、双重转换会洗白）
        tex.colorSpace = THREE.NoColorSpace;
        tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1; // 侧视/旋转不糊
        return tex;
      }));
    }
    return skinTexCache.get(key);
  }

  // 皮肤上身：换成官方卡通 shader（顶点色是遮罩数据，直接丢弃；几何细节靠贴图）
  const whiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  whiteTex.needsUpdate = true;
  function applyToonSkin(obj, tex, vp) {
    obj.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      o.material = makeToonMaterial(tex || whiteTex, vp);
    });
  }

  // ---- 配件随皮肤变体挂载（skinparams.json 数据驱动；art prefab 到齐后生效）----
  // skinparams.json 约定：
  //   _shared._accessoryGroups: ["配件节点名子串", ...]（以 art prefab 实际节点名为准，大小写不敏感）
  //   cakeNN.accessories: ["该猫佩戴的配件组名"]（_accessoryGroups 的子集）
  // 命中配件组但不在该猫佩戴清单里的网格 → 隐藏；未配置 _accessoryGroups 时全部显示（现状）
  function applyVariantNodes(obj, vp, params) {
    const groups = params && params._shared && params._shared._accessoryGroups;
    if (!groups || !groups.length) return;
    const worn = new Set(vp.accessories || []);
    obj.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      const g = groups.find((g) => o.name.toLowerCase().includes(String(g).toLowerCase()));
      if (g && !worn.has(g)) o.visible = false;
    });
  }

  // ---- 官方动画（可选资产，缺席时全自动回退程序化关键帧，行为与之前一致）----
  // models/anims.json 清单：{ "StandBy": "anims/xxx.glb#剪辑名", ... }（value 相对 models/；#剪辑名可省略）
  // 预期 key：StandBy（常驻待机）/ Roar01AS / Roar01BS / Roar01Loop / Talk01 / Blink（眨眼，可选）
  let animManifestP = null;
  const animClipCache = new Map(); // key -> Promise<AnimationClip|null>
  let officialClips = {};          // key -> AnimationClip（全部预载完成后可用）

  function loadAnimManifest() {
    if (!animManifestP) {
      animManifestP = fetch('cake://models/anims.json')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null); // 无清单 = 无官方动画资产，静默跳过
    }
    return animManifestP;
  }

  function loadAnimClip(key) {
    if (!animClipCache.has(key)) {
      animClipCache.set(key, loadAnimManifest().then(async (mf) => {
        const rel = mf && mf[key];
        if (!rel) return null;
        // 支持 "文件.glb#剪辑名"：一个 GLB 装多条剪辑时按名挑选；不带 # 则按 key 匹配或取第一条
        const hashIdx = rel.indexOf('#');
        const file = hashIdx >= 0 ? rel.slice(0, hashIdx) : rel;
        const want = hashIdx >= 0 ? rel.slice(hashIdx + 1) : key;
        try {
          // .json = 转换好的 THREE.AnimationClip（如 emo 眨眼剪辑，tools/anim2clip 产物）；
          // 其它 = GLB 动画库
          if (file.endsWith('.json')) {
            const clipJson = await fetch('cake://models/' + file).then((r) => {
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return r.json();
            });
            return THREE.AnimationClip.parse(clipJson);
          }
          const g = await loadAnimGltf(file);
          const clips = g.animations || [];
          if (!clips.length) return null;
          return clips.find((c) => c.name === want) ||
            clips.find((c) => c.name.toLowerCase().includes(want.toLowerCase())) ||
            clips[0];
        } catch (e) {
          console.warn(`[pet3d] 官方动画 ${key}(${rel}) 加载失败，该动作走程序化`, (e && e.message) || e);
          return null;
        }
      }));
    }
    return animClipCache.get(key);
  }

  // 动画 GLB 按文件缓存：多个 key 指向同一文件时只加载一次
  const animGltfCache = new Map(); // file -> Promise<GLTF>
  function loadAnimGltf(file) {
    if (!animGltfCache.has(file)) {
      animGltfCache.set(file, gltfLoader.loadAsync('cake://models/' + file));
    }
    return animGltfCache.get(file);
  }

  // 预载清单内全部剪辑进 officialClips（首次换猫时执行一次；无清单则保持空表）
  let officialClipsP = null;
  function loadOfficialClips() {
    if (!officialClipsP) {
      officialClipsP = loadAnimManifest().then(async (mf) => {
        if (!mf) return;
        await Promise.all(Object.keys(mf).map(async (k) => {
          const c = await loadAnimClip(k);
          if (c) officialClips[k] = c;
        }));
        const keys = Object.keys(officialClips);
        if (keys.length) console.log('[pet3d] 官方动画就绪：' + keys.join('、'));
      });
    }
    return officialClipsP;
  }

  // 3D 布局：#app 恒 0,0 不缩放（2D 的 scale 体系由 cake.js applyZoom 保留）；
  // #stage 撑满窗口，内部绝对定位的 DOM 覆盖物（影子等）即相对窗口定位
  function apply3DLayout() {
    canvas.style.display = '';
    appEl.style.left = '0px';
    appEl.style.top = '0px';
    appEl.style.transform = 'none';
    stage.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;width:auto;height:auto;';
    // 影子位置/尺寸改由 JS 每帧投影驱动，清掉 CSS 的 bottom/margin 定位
    shadow.style.bottom = 'auto';
    shadow.style.marginLeft = '0';
    // 3D 接管：隐藏 2D 立绘和 DOM 轮廓光，影子改由 JS 驱动
    img.style.display = 'none';
    edgeGlow.style.display = 'none';
    shadow.style.animation = 'none';
  }

  // 进入 2D webp 布局（故障兜底与用户切 2D 共用）：停 rAF、藏 canvas、恢复 #app scale 体系
  function enter2DLayout() {
    cancelAnimationFrame(rafId);
    rafId = 0;
    if (canvas) canvas.style.display = 'none';
    img.style.display = '';
    edgeGlow.style.display = '';
    // 还原 2D 布局相关的内联样式（stage/影子/气泡）
    stage.style.cssText = '';
    shadow.style.cssText = '';
    bubbleEl.style.cssText = '';
    // 恢复 2D 的 #app scale 体系并重贴窗口（applyZoom 内部会调 refreshShape2D）
    if (window.cakeApplyZoom) window.cakeApplyZoom();
    else updateShape2D();
  }

  // 切回 3D 布局：恢复 canvas/全窗 stage/相机取景/窗口包络，重启 rAF（WebGL 状态保留不重建）
  function enter3DLayout() {
    apply3DLayout();
    updateBuffer();
    fitCamera();
    layoutShadow();
    layout(); // 窗口贴回 3D 包络
    if (!rafId && !document.hidden) {
      lastT = performance.now();
      lastRenderT = 0;
      rafId = requestAnimationFrame(loop);
    }
  }

  // 用户显示模式开关（renderMode 配置）：可逆切换；renderer/scene/模型缓存全部保留
  function setRenderMode(mode) {
    const m = (mode === '2d' || mode === '2d-art') ? '2d' : '3d'; // 两种 2D（立绘/正视）都走 2D 路径
    if (m === userMode) return;
    userMode = m;
    const was = available;
    syncAvailable();
    if (was === available) return; // 故障兜底中：切开关只记 userMode，故障解除前不动布局
    if (available) {
      // 切回 3D：2D 期间可能换过猫，先同步当前形象再恢复布局
      setCake(window.currentCakeId || 'cake01').then(() => { if (available) enter3DLayout(); });
    } else {
      enter2DLayout();
    }
  }

  // 故障回退 2D webp 模式（WebGL 上下文丢失 / cake.glb 加载失败）：
  // 只记故障标志，userMode 不动——故障恢复后仍按用户选择的模式渲染
  function fallbackTo2D() {
    fault2D = true;
    const was = available;
    syncAvailable();
    if (was) enter2DLayout();
  }

  // lazy load + 缓存；cake.glb 或皮肤加载失败时回退 2D webp 模式
  function loadCake(id) {
    if (modelCache.has(id)) return modelCache.get(id);
    const p = (async () => {
      const n = parseInt(String(id).replace(/\D/g, ''), 10) || 1;
      try {
        const gltf = await loadBaseModel();
        const params = await loadSkinParams();
        const vp = (params && params[`cake${String(n).padStart(2, '0')}`]) || DEFAULT_VARIANT;
        const obj = skeletonClone(gltf.scene); // 骨架实例各自独立
        try {
          applyToonSkin(obj, await loadSkinTex(n), vp);
        } catch (e) {
          console.warn(`[pet3d] skin${String(n).padStart(2, '0')}.png 加载失败，用素模`, (e && e.message) || e);
          applyToonSkin(obj, null, vp);
        }
        applyVariantNodes(obj, vp, params); // 配件随变体挂载（隐藏未佩戴的，须在套壳之前）
        await loadOfficialClips();          // 官方动画预载（无 anims.json 时秒回）
        addOutlineShells(obj, vp); // 官方常时描边
        addGlowShells(obj);        // 交互流光壳（叠加在描边之上）
        return { holder: normalizeModel(obj), inner: obj, clips: gltf.animations || [] };
      } catch (e) {
        console.warn('[pet3d] cake.glb 加载失败，回退 2D webp 模式', (e && e.message) || e);
        modelCache.delete(id); // 不缓存失败项，模型文件恢复后重进 3D 可重试
        fallbackTo2D();
        return { holder: new THREE.Group(), inner: new THREE.Group(), clips: [] };
      }
    })();
    modelCache.set(id, p);
    return p;
  }

  async function setCake(id) {
    if (!available) return;
    const tk = ++cakeToken;
    const entry = await loadCake(id);
    if (tk !== cakeToken) return; // 期间又换了别的
    if (mixer) mixer.stopAllAction(); // 旧猫 mixer 全部停掉（含 StandBy 循环）
    if (exprMixer) exprMixer.stopAllAction();
    standbyAction = null;
    exprHold = null;
    moveLoopAction = null;
    clearTimeout(blinkTimer);
    modelRoot.clear();
    modelRoot.add(entry.holder);
    currentEntry = entry;
    mixer = (entry.clips.length || Object.keys(officialClips).length)
      ? new THREE.AnimationMixer(entry.inner) : null;
    exprMixer = mixer ? new THREE.AnimationMixer(entry.inner) : null; // 表情层（后 update 覆写眼睑）
    startStandby();   // 官方 StandBy 常驻打底（无该剪辑时 no-op）
    scheduleBlink();  // 官方眨眼剪辑定时播（无该剪辑时 no-op）
    computeEnvelope(); // 换猫后重算静态包络（角点法，毫秒级）
    layout();          // 窗口贴包络 + 相机重 fit，之后动作/旋转/待机期间冻结
  }

  // ---- 取景与窗口布局：包络在世界坐标一次算好，相机 fit 进全窗 canvas，窗口贴包络冻结 ----
  // 包络 = bind 几何包围盒 8 角点 × 24 个视角（8 yaw × pitch 0/±30°）变换并集 + 常数动作余量，
  // 纯角点矩阵运算（禁止逐顶点逐帧采样），换猫/petSize 变化时重算一次后冻结
  let petSize = 240;
  let envBox = null;        // {x0,y0,x1,y1} 世界坐标静态包络
  let restTop = TARGET_H;   // 模型静止位形头顶高度（气泡投影定位用）
  let firstFrameDone = false;

  function computeEnvelope() {
    if (!available || !currentEntry) return;
    // modelRoot/viewGroup 归位：包络在静止位形下取，动作/视角只是外层矩阵
    const sp = modelRoot.position.clone(), sr = modelRoot.rotation.clone(), ss = modelRoot.scale.clone();
    const sv = viewGroup.rotation.clone();
    modelRoot.position.set(0, 0, 0);
    modelRoot.rotation.set(0, 0, 0);
    modelRoot.scale.set(1, 1, 1);
    viewGroup.rotation.set(0, 0, 0);
    viewGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(modelRoot); // bind 几何包围盒（壳与本体同几何，不影响）
    modelRoot.position.copy(sp);
    modelRoot.rotation.copy(sr);
    modelRoot.scale.copy(ss);
    viewGroup.rotation.copy(sv);
    restTop = box.max.y;
    // 8 角点 × 24 视角变换并集（取 x/y 极限，z 深度差由余量吸收）
    const corners = [];
    for (const cx of [box.min.x, box.max.x])
      for (const cy of [box.min.y, box.max.y])
        for (const cz of [box.min.z, box.max.z])
          corners.push(new THREE.Vector3(cx, cy, cz));
    const v = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const e = new THREE.Euler();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let yi = 0; yi < 8; yi++) {
      for (const pitch of [0, PITCH_LIMIT, -PITCH_LIMIT]) {
        e.set(pitch, yi * Math.PI / 4, 0, 'YXZ');
        m.makeRotationFromEuler(e);
        for (const c of corners) {
          v.copy(c).applyMatrix4(m);
          if (v.x < x0) x0 = v.x;
          if (v.x > x1) x1 = v.x;
          if (v.y < y0) y0 = v.y;
          if (v.y > y1) y1 = v.y;
        }
      }
    }
    // px 余量换算成世界单位：PX ≈ 包络宽 / (视野占比 × 窗口宽)
    const PXest = (x1 - x0) / ((1 - 2 * VIEW_MARGIN) * petSize);
    const restHX = (box.max.x - box.min.x) / 2;
    // 横向取各动作真实最坏组合的max（不过度叠乘）：
    // a) duang 静止挤压 1.22×静止半宽  b) 视角/待机旋转并集半宽（对角扫掠）
    // c) 歪头绕底心旋转外扩；spin 空中转体时缩 0.8，已被 b 覆盖
    const halfW = Math.max(
      restHX * SQUASH_X,
      (x1 - x0) / 2,
      restHX * Math.cos(TILT_RAD) + restTop * Math.sin(TILT_RAD)
    ) + SIDE_PX * PXest;
    // 纵向：a) 视角并集顶 × 挤压 1.14（组合上界）  b) spin 腾空：0.8 压缩顶 + 跳跃高度
    envBox = {
      x0: -halfW, x1: halfW,
      y0: Math.min(y0, box.min.y) - (FLOAT_AMP_PX + 4 + SHADOW_PX) * PXest,
      y1: Math.max(y1 * SQUASH_Y, restTop * 0.8 + JUMP_PX * PXest) + (FLOAT_AMP_PX + 4) * PXest,
    };
  }

  // 相机：把世界包络 fit 进当前窗口视野（四周 VIEW_MARGIN 边距）；窗口 resize 时重 fit
  function fitCamera() {
    if (!envBox) return;
    const w = window.innerWidth, h = window.innerHeight;
    if (!w || !h) return;
    const envW = envBox.x1 - envBox.x0, envH = envBox.y1 - envBox.y0;
    const a = w / h;
    const visibleH = Math.max(envH, envW / a) / (1 - 2 * VIEW_MARGIN);
    const dist = visibleH / (2 * Math.tan(15 * D2R)); // fov 30°
    const cx = (envBox.x0 + envBox.x1) / 2, cy = (envBox.y0 + envBox.y1) / 2;
    camera.aspect = a;
    camera.updateProjectionMatrix();
    camera.position.set(cx, cy, dist);
    camera.lookAt(cx, cy, 0);
    camera.updateMatrixWorld(true);
    PX = visibleH / h; // 1 css px 的世界单位（动作位移轨道换算用）
  }

  // ---- 性能模式：软渲染老机器（如 HD 3000 核显走 SwiftShader）降像素+限帧，CPU 占用可降 6~7 倍 ----
  // perfMode: auto（软渲染→saver，硬件 GPU→high）| saver 省电 | balanced 均衡 | high 高画质 | custom 自定义
  const PERF_PRESETS = {
    saver: { ssaa: 1.0, fps: 20 },
    balanced: { ssaa: 1.0, fps: 30 },
    high: { ssaa: 1.5, fps: 60 },
  };
  let perfMode = 'auto';
  let perfCustomSSAA = 1.0, perfCustomFPS = 30; // custom 档参数（设置页滑块）
  let softGL = false;     // init 时探测：WebGL 是否软件渲染
  let glRendererStr = ''; // UNMASKED_RENDERER 字符串，诊断用（让用户发设置页截图即可确诊）
  let effSSAA = 1.5;      // 有效超采样倍率（updateBuffer 用）
  let frameInterval = 0;  // 帧间隔 ms，0 = 不限帧
  let lastRenderT = 0;    // 上次实际渲染时间戳（0 = 下一帧必渲染）
  let frameCount = 0;     // 实际渲染帧计数（debugInfo 采样算真实帧率，验证限帧用）

  // 探测软件渲染：临时 probe 上下文读渲染器字符串；必须在正式 renderer 创建前调（antialias 是创建参数）
  function detectSoftGL() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return true; // 拿不到上下文按最省处理
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      glRendererStr = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return /swiftshader|llvmpipe|softpipe|software|angle \(google/i.test(glRendererStr);
    } catch { return false; }
  }

  // 解析 perfMode → 有效 SSAA/帧间隔；实时切换不用重启（antialias 除外，只能 init 决策）
  function applyPerf() {
    let m = perfMode === 'auto' ? (softGL ? 'saver' : 'high') : perfMode;
    let p;
    if (m === 'custom') {
      p = { ssaa: Math.min(2, Math.max(0.5, perfCustomSSAA || 1)), fps: Math.min(60, Math.max(15, perfCustomFPS || 30)) };
    } else {
      p = PERF_PRESETS[m] || PERF_PRESETS.high;
    }
    effSSAA = p.ssaa;
    frameInterval = p.fps >= 60 ? 0 : 1000 / p.fps;
    lastRenderT = 0; // 切档后下一帧立即按新节奏渲染
    updateBuffer();
  }

  // ---- 清晰度：buffer = 窗口实际像素 × DPR × 有效超采样（CSS 尺寸始终 100% 窗口）----
  function updateBuffer() {
    if (!renderer) return;
    const s = (window.devicePixelRatio || 1) * effSSAA;
    renderer.setSize(Math.max(1, Math.round(window.innerWidth * s)),
      Math.max(1, Math.round(window.innerHeight * s)), false);
  }

  // ---- 异形窗口落地 ----
  // 渲染进程只发目标内容尺寸 {w,h}（CSS px），位置由主进程按「内容区底边中心」锚定自算。
  // 曾经的双向单位校准（unitK/boundsUnitM）已拆除：同学的 Windows（150% 缩放）实测
  // getBounds 会混入 DWM 隐形边框且随焦点漂移，基于它的校准会把垃圾放大成失控。
  // 现在主进程全走内容坐标系（getContentBounds/setContentSize），渲染进程零状态。
  // ack：主进程实际落地的内容尺寸。150% 缩放下请求 625 只能落 626/628（物理像素取整），
  // 若只认 innerWidth/Height 作守卫，目标永远差 2~3px → 每帧重发 shape 风暴；
  // 采纳 ack 作为「已收敛」判据后风暴终止（主进程那边尺寸不变也会幂等短路）
  let ackW = 0, ackH = 0;
  function shapeSettled(w, h) {
    if (Math.abs(w - window.innerWidth) <= 2 && Math.abs(h - window.innerHeight) <= 2) return true;
    return ackW > 0 && Math.abs(w - ackW) <= 2 && Math.abs(h - ackH) <= 2;
  }
  function sendShape(w, h) {
    const req = { w: Math.round(w), h: Math.round(h) };
    window.api.debugLog(`[sendShape] req=${JSON.stringify(req)} inner=${window.innerWidth}x${window.innerHeight}`);
    window.api.setShape(req).then((fin) => {
      if (fin && isFinite(fin.width + fin.height)) { ackW = fin.width; ackH = fin.height; }
    }).catch(() => { /* 窗口已销毁等 */ });
  }

  // 窗口尺寸 = 包络宽高比 × petSize 基准；底边中心锚定（模型落脚点不动）；
  // 设一次后冻结——动作/旋转/待机都被静态包络覆盖，不再动窗口
  function layout() {
    if (!available || !envBox) return;
    // 3D 的 DOM 覆盖物（气泡/提示/托柄）不随 transform scale，单独按 petSize 比例缩放
    document.documentElement.style.setProperty('--ui-k', (petSize / 240).toFixed(3));
    const envW = envBox.x1 - envBox.x0, envH = envBox.y1 - envBox.y0;
    const w = Math.round(petSize);
    const h = Math.round(petSize * envH / envW);
    if (!shapeSettled(w, h)) {
      // win:shape 语义：只要目标内容尺寸，位置主进程按底边中心锚定（幂等，重复发不漂移）
      console.log(`[pet3d:layout] ${w}x${h}`);
      sendShape(w, h);
    }
    updateBuffer();
    fitCamera();
    layoutShadow();
  }

  // 地面影子尺寸：窗口宽 × 视野占比 × 0.5，随档位缩放（位置每帧投影放置）
  function layoutShadow() {
    const wpx = Math.round(window.innerWidth * (1 - 2 * VIEW_MARGIN) * 0.5);
    shadow.style.width = wpx + 'px';
    shadow.style.height = Math.max(8, Math.round(wpx / 6)) + 'px';
  }

  // 世界点 → 窗口 client 坐标（canvas 铺满窗口，client 即 canvas 坐标）
  const projV = new THREE.Vector3();
  const groundV = new THREE.Vector3();
  const shadowPos = { x: 0, y: 0 };
  const bubblePos = { x: 0, y: 0 };
  function projectToClient(x, y, z, out) {
    projV.set(x, y, z).project(camera);
    out.x = (projV.x + 1) / 2 * window.innerWidth;
    out.y = (1 - projV.y) / 2 * window.innerHeight;
  }

  // ---- 播放动作：官方剪辑优先（语义映射 → 同名匹配），否则走程序化关键帧 ----
  // 语义映射表（实机校准改这里）：value = anims.json key 字符串，或 { clips: [key,...] 连播, proc: 'act-xxx' 程序化叠加 }
  // 不在表里的动作名直接当官方 key 试播（pet3d.play("Hit")）；都没有再退化程序化
  const OFFICIAL_ACTION_MAP = {
    'act-wiggle': { clips: ['Roar01AS', 'Roar01Loop', 'Roar01BS'] }, // 完整吼叫 = 起→循环→收（游戏内原样）
    'act-hop': { clips: ['Jump', 'Landing'], proc: 'hop-lift' }, // 官方跳+落地 + 程序化腾空弧线
    'act-tilt': 'Talk01',     // 疑惑歪头 → 说话动作
    // act-duang（果冻 Q 弹）/ act-spin（360° 转体）官方剪辑无对应，保持程序化
    // （Falldown 平视角度是脸埋地里，观感不对，不接）
  };
  let standbyAction = null; // StandBy 常驻循环打底
  let blinkTimer = 0;

  // 官方 StandBy 常驻待机循环（骨骼动画与 modelRoot 程序化变换分层，互不干扰）
  function startStandby() {
    if (!mixer || !officialClips.StandBy) return;
    standbyAction = mixer.clipAction(officialClips.StandBy);
    standbyAction.setLoop(THREE.LoopRepeat, Infinity);
    standbyAction.play();
  }

  // ---- 表情层：独立 exprMixer 在主 mixer 之后 update，覆写眼睑关节 ----
  //（StandBy 也写全部眼睑轨道，同 mixer 混合会变成「半闭眼」；双 mixer 后写者胜出，干净）
  let exprMixer = null;
  let exprHold = null;     // 当前保持中的表情 action（如眯眼笑）
  function playExpr(clip, hold) {
    if (!exprMixer || !clip) return;
    exprMixer.stopAllAction();
    exprHold = null;
    const a = exprMixer.clipAction(clip);
    a.reset().setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = !!hold;
    a.play();
    if (hold) { exprHold = a; return; }
    const onFin = (e) => {
      if (e.action !== a) return;
      exprMixer.removeEventListener('finished', onFin);
      a.stop(); // 停后当帧起 StandBy 重新接管眼睑
    };
    exprMixer.addEventListener('finished', onFin);
  }
  // 眯眼笑等保持表情：setExpression('CloseEye')；复位用 DefaultEye 过渡回待机
  function setExpression(key) { playExpr(officialClips[key], true); }
  function clearExpression() {
    if (officialClips.DefaultEye) playExpr(officialClips.DefaultEye, false);
    else if (exprMixer) { exprMixer.stopAllAction(); exprHold = null; }
  }

  // 官方眨眼：每 3~7 秒播一次（表情层覆写；保持表情期间跳过）
  function scheduleBlink() {
    clearTimeout(blinkTimer);
    if (!mixer || !officialClips.Blink) return;
    blinkTimer = setTimeout(() => {
      if (mixer && !document.hidden && !exprHold) playExpr(officialClips.Blink, false);
      scheduleBlink();
    }, 3000 + Math.random() * 4000);
  }

  // 程序化动作启动。轮换规则（用户定）：同一时刻只用一个动作源——
  // 程序化动作独占时 StandBy 淡出（播完由 tick 淡回），不再骨架+程序双层叠加（叠了像海绵）
  function startProc(defName, onDone) {
    const def = ACTIONS3D[defName];
    if (!def) { if (onDone) onDone(); return false; }
    stopChain(); // 官方连播进行中时打断（否则转圈会和吼叫同时播——互斥规则的两个方向都要堵）
    if (curAction && curAction.onDone) curAction.onDone(); // 打断旧动作，对齐摘类语义
    curAction = { def, start: performance.now(), onDone };
    if (standbyAction) standbyAction.fadeOut(0.25);
    return true;
  }

  function resumeStandby() {
    if (standbyAction) standbyAction.reset().fadeIn(0.25).play();
  }

  function play(name, onDone) {
    if (!available) { if (onDone) onDone(); return false; }
    const clipName = String(name).replace(/^(act-|idle-)/, '');
    if (mixer && currentEntry) {
      const mapped = OFFICIAL_ACTION_MAP[name];
      const spec = typeof mapped === 'string' ? { clips: [mapped] } : mapped;
      const clips = spec ? (spec.clips || []).map((k) => officialClips[k]).filter(Boolean) : [];
      const single = !spec && (officialClips[name] ||
        currentEntry.clips.find((c) => c.name === clipName || c.name === name));
      if (single) clips.push(single);
      if (clips.length) {
        // 官方剪辑（可连播）+ 可选程序化叠加；onDone 在两者都结束后只调一次
        let procDone = !(spec && spec.proc);
        let clipDone = false;
        const fin = () => { if (procDone && clipDone && onDone) onDone(); };
        if (spec && spec.proc) startProc(spec.proc, () => { procDone = true; fin(); });
        playChain(clips, () => { clipDone = true; fin(); });
        return true;
      }
    }
    return startProc(name, onDone);
  }

  // 连播：首段与 StandBy 交叉淡化；段间/末段定格末帧交叉淡出——
  // 直接 stop 会让骨骼瞬间回落绑定姿势（总权重 <1 时 mixer 填 bind pose），就是用户看到的「抽搐」
  let chainRunning = false;
  let chainGen = 0;       // 连播代际：被打断的旧链 next() 自动失效（否则两条链混播）
  let chainCur = null;    // 连播当前段 action（打断时淡出）
  let chainOnDone = null; // 连播完成回调（打断时调用，对齐摘类语义）
  function stopChain() {
    if (!chainRunning) return;
    chainRunning = false;
    chainGen++;
    const cb = chainOnDone; chainOnDone = null;
    // 动作对象按剪辑复用（mixer.clipAction 缓存）：延时 stop 前必须确认它没被新链重启，
    // 否则会把新链的当前段停掉，新链永远等不到 finished（卡死）
    if (chainCur) { const a = chainCur; chainCur = null; a.fadeOut(0.15); setTimeout(() => { if (!a.isRunning()) a.stop(); }, 300); }
    if (cb) cb();
  }
  function playChain(clips, onDone) {
    if (curAction && curAction.onDone) curAction.onDone();
    curAction = null;
    stopChain(); // 打断旧连播（连续点同一动作时旧链的 finished 回调还会推进，必须作废）
    chainRunning = true;
    const gen = chainGen; // stopChain 已递增，取到的即是新代际
    chainOnDone = onDone;
    let i = 0;
    let prevAction = null;
    const next = () => {
      if (gen !== chainGen) return; // 已被打断的旧链不再推进
      if (i >= clips.length) {
        chainRunning = false;
        chainGen++;
        chainOnDone = null;
        chainCur = null;
        resumeStandby();
        if (prevAction) { // 末段定格帧与 StandBy 交叉淡化 0.25s，然后再真正 stop
          const last = prevAction;
          last.fadeOut(0.25);
          setTimeout(() => { if (!last.isRunning()) last.stop(); }, 400); // 被新链重启则不 stop（对象复用）
        }
        if (onDone) onDone();
        return;
      }
      const a = mixer.clipAction(clips[i++]);
      chainCur = a;
      a.reset().setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true; // 播完定格末帧，交给下一段/待机交叉淡化
      if (standbyAction && i === 1) { standbyAction.fadeOut(0.15); a.fadeIn(0.15); }
      else if (prevAction) { prevAction.fadeOut(0.12); a.fadeIn(0.12); }
      a.play();
      const onFin = (e) => {
        if (e.action !== a) return;
        mixer.removeEventListener('finished', onFin);
        prevAction = a; // 不 stop：定格帧参与交叉淡化
        next();
      };
      mixer.addEventListener('finished', onFin);
    };
    next();
  }

  // ---- 拖动走路：拖动窗口时播 MoveAS→Move 循环，松手淡回 StandBy ----
  let moveLoopAction = null;   // Move 循环 action
  let moveStarting = false;    // MoveAS 起步播放中
  let draggingMove = false;    // 拖动进行中（松手后 MoveAS 播完也不再进循环）
  let lastMovePulse = 0;       // 最近一次拖动位移（拖静止超时就停走路，不再一直跳）
  function dragPulse() {
    lastMovePulse = performance.now();
    // 静止超时把走路停掉了的话，重新起步
    if (available && draggingMove && !moveLoopAction && !moveStarting && mixer && officialClips.Move) {
      if (standbyAction) standbyAction.fadeOut(0.15);
      moveLoopAction = mixer.clipAction(officialClips.Move);
      moveLoopAction.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.15).play();
    }
  }
  function dragStart() {
    if (!available || !mixer || !officialClips.Move || moveLoopAction || moveStarting) return;
    draggingMove = true;
    lastMovePulse = performance.now();
    if (standbyAction) standbyAction.fadeOut(0.2);
    const startLoop = () => {
      moveLoopAction = mixer.clipAction(officialClips.Move);
      moveLoopAction.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.1).play();
    };
    if (officialClips.MoveAS) {
      moveStarting = true;
      const a = mixer.clipAction(officialClips.MoveAS);
      a.reset().setLoop(THREE.LoopOnce, 1).play();
      const onFin = (e) => {
        if (e.action !== a) return;
        mixer.removeEventListener('finished', onFin);
        a.stop();
        moveStarting = false;
        if (draggingMove) startLoop();
      };
      mixer.addEventListener('finished', onFin);
    } else {
      startLoop();
    }
  }
  function dragEnd() {
    draggingMove = false;
    if (moveLoopAction) { moveLoopAction.fadeOut(0.2); moveLoopAction = null; }
    // 连播/程序化动作独占中则不抢戏，否则淡回待机
    if (!chainRunning && !curAction) resumeStandby();
    // 拖动期间压住的假 resize（OS 边距累积）统一 settle：窗口贴回包络、相机重 fit
    if (available) { updateBuffer(); fitCamera(); layoutShadow(); layout(); }
  }

  // ---- 主循环：常驻浮动 + 动作叠加 + 影子 + 流光淡入淡出 ----
  // 动作轨道采样（tick 和静态包络预算共用）：返回该进度下的 transform 增量
  function sampleAction(def, p) {
    const out = { py: 0, px: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };
    const tr = def.t;
    for (const k in tr) {
      const v = sampleTrack(tr[k], p);
      if (k === 'py') out.py = v;
      else if (k === 'px') out.px = v;
      else if (k === 'rz') out.rz = v * D2R;
      else if (k === 'ry') out.ry = v * D2R;
      else if (k === 'rx') out.rx = v * D2R;
      else if (k === 'sx') out.sx = v;
      else if (k === 'sy') out.sy = v;
      else if (k === 'sz') out.sz = v;
    }
    if (!tr.sz) out.sz = out.sx; // 厚度跟随横向缩放，果冻感更自然
    return out;
  }

  function tick(now) {
    const dt = animFrozen ? 0 : Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const t = now / 1000;

    // 拖动但静止超过 0.35s：停走路循环淡回待机（按住不动还一直跳观感很怪）
    if (draggingMove && moveLoopAction && now - lastMovePulse > 350) {
      moveLoopAction.fadeOut(0.25);
      moveLoopAction = null;
      if (!chainRunning && !curAction) resumeStandby();
    }

    // 常驻 float：position.y 正弦（冻结时静止，截图不飘）
    let py = animFrozen ? 0 : Math.sin(t * Math.PI * 2 / FLOAT_PERIOD) * FLOAT_AMP_PX;
    let px = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1;

    if (curAction && !animFrozen) {
      const p = (now - curAction.start) / 1000 / curAction.def.dur;
      if (p >= 1) {
        const cb = curAction.onDone;
        curAction = null; // 静态包络下动作不影响窗口，无需触发 shape
        if (!chainRunning) resumeStandby(); // 程序化动作独占结束，StandBy 淡回（连播还在跑则不动）
        if (cb) cb();
      } else {
        const a = sampleAction(curAction.def, p);
        px = a.px; py += a.py;
        rx = a.rx; ry = a.ry; rz = a.rz;
        sx = a.sx; sy = a.sy; sz = a.sz;
      }
    }

    modelRoot.position.set(px * PX, py * PX, 0);
    modelRoot.rotation.set(rx, ry, rz);
    modelRoot.scale.set(sx, sy, sz);

    // 离地高度（浮动 + 跳跃）：影子缩放/变淡用，替代原 shadowFloat/shadowSpin CSS
    const lift = Math.max(0, Math.min(py, 34)) / 34; // 0~1，34px 为跳满高度

    // 流光：淡入淡出 + 彩虹模式色相流动
    const target = now < glowUntil ? 1 : 0;
    glowAlpha += (target - glowAlpha) * Math.min(1, dt * 6);
    if (glowAlpha < 0.005 && target === 0) glowAlpha = 0;
    if (glowMat) {
      glowMat.uniforms.uAlpha.value = glowAlpha;
      glowMat.uniforms.uHue.value = t * 0.12;
    }

    if (mixer) mixer.update(dt);
    if (exprMixer) exprMixer.update(dt); // 表情层后 update：眨眼/眯眼覆写 StandBy 的眼睑轨道
    renderer.render(scene, camera);
    if (!firstFrameDone) {
      firstFrameDone = true;
      console.timeEnd('[pet3d] 启动→首帧');
      window.__pet3dFirstFrameT = performance.now(); // 启动耗时验收用
    }

    // DOM 覆盖物每帧投影放置（render 后 matrixWorld 已刷新；canvas 铺满窗口，client 即窗口坐标）
    // 影子：模型底部中心（地面点，不跟跳跃升高）投影到窗口坐标
    groundV.set(modelRoot.position.x, 0, 0).applyMatrix4(viewGroup.matrixWorld);
    projectToClient(groundV.x, groundV.y, groundV.z, shadowPos);
    const sScale = 1 - 0.45 * lift;
    shadow.style.left = shadowPos.x.toFixed(1) + 'px';
    shadow.style.top = shadowPos.y.toFixed(1) + 'px';
    shadow.style.transform = `translate(-50%,-50%) scaleX(${sScale.toFixed(3)})`;
    shadow.style.opacity = (0.9 - 0.45 * lift).toFixed(3);

    // 气泡：静态包络顶部投影（包络已覆盖全动作全角度，动作跳再高也盖不到脑袋；仅显示时更新）
    if (bubbleEl && bubbleEl.classList.contains('show') && envBox) {
      groundV.set(0, envBox.y1, 0).applyMatrix4(viewGroup.matrixWorld);
      projectToClient(groundV.x, groundV.y, groundV.z, bubblePos);
      const bw = bubbleEl.offsetWidth, bh = bubbleEl.offsetHeight;
      const bx = Math.min(Math.max(bubblePos.x, bw / 2 + 4), window.innerWidth - bw / 2 - 4);
      const by = Math.max(4, bubblePos.y - bh - 8);
      bubbleEl.style.left = bx.toFixed(1) + 'px';
      bubbleEl.style.top = by.toFixed(1) + 'px';
      bubbleEl.style.transform = 'translateX(-50%)';
    }
  }

  function loop(now) {
    rafId = requestAnimationFrame(loop);
    // 限帧：帧间隔未到就空转（rAF 本身成本可忽略；动画 dt 由 tick 内钳制兼容降帧）
    if (frameInterval && lastRenderT && now - lastRenderT < frameInterval * 0.97) return;
    lastRenderT = now;
    frameCount++;
    tick(now);
  }

  // 窗口隐藏时停 rAF 省电
  document.addEventListener('visibilitychange', () => {
    if (!available) return;
    if (document.hidden) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    } else if (!rafId) {
      lastT = performance.now();
      lastRenderT = 0; // 恢复后必渲染一帧，不吃限帧闸门
      rafId = requestAnimationFrame(loop);
    }
  });

  // ---- 命中检测：canvas 铺满窗口，client 坐标直接换算 NDC + Raycaster 精判 ----
  function hitTest(clientX, clientY) {
    if (!available || !canvas) return false;
    const w = window.innerWidth, h = window.innerHeight;
    if (clientX < 0 || clientX > w || clientY < 0 || clientY > h) return false;
    if (!currentEntry) return true; // 模型加载中，窗口内都算
    const nx = (clientX / w) * 2 - 1;
    const ny = -(clientY / h) * 2 + 1;
    raycaster.setFromCamera({ x: nx, y: ny }, camera);
    // Raycaster 不查 visible：隐藏的配件网格不该挡子弹（命中链上有不可见节点即丢弃）
    return raycaster.intersectObject(modelRoot, true).some((h) => {
      for (let o = h.object; o; o = o.parent) if (!o.visible) return false;
      return true;
    });
  }

  function setGlowColor(name) {
    glowColorName = name || 'rainbow';
    if (!glowMat) return;
    const g = GLOW3D[glowColorName] || GLOW3D.rainbow;
    glowMat.uniforms.uColor.value = new THREE.Color(g.color);
    glowMat.uniforms.uRainbow.value = g.rainbow;
  }

  // ---- 观看角度：Shift+拖动旋转（yaw 自由，pitch 限 ±30°），双击重置 ----
  let viewYaw = 0, viewPitch = 0;
  const PITCH_LIMIT = Math.PI / 6;
  function applyView() {
    viewGroup.rotation.set(viewPitch, viewYaw, 0, 'YXZ'); // 先 yaw 后 pitch
  }
  function setViewAngle(yaw, pitch) {
    viewYaw = yaw;
    viewPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
    applyView();
    // 静态包络已覆盖全角度，旋转不触发 shape
  }

  // ---- 2D 回退的异形窗口：窗口贴整个 #app 容器（3D 模式窗口由 layout() 一次冻结）----
  // cake.js applyZoom 在 2D 缩放后调用 refreshShape2D 重贴
  function updateShape2D() {
    const r = appEl.getBoundingClientRect();
    // 只发目标内容尺寸；底边中心锚定在主进程统一处理（2D/3D 同一锚点，互切落脚点不动）
    const w = Math.ceil(r.width), h = Math.ceil(r.height);
    if (shapeSettled(w, h)) return; // 已是目标尺寸（幂等守卫，含主进程 ack 落地尺寸）
    sendShape(w, h);
  }

  // ---- 初始化：WebGL 上下文创建失败则整体回退 2D ----
  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });

  function init() {
    console.time('[pet3d] WebGL 初始化');
    softGL = detectSoftGL(); // 先探测：软渲染时 antialias 关掉（创建参数，运行时改不了）
    console.log('[pet3d] GL renderer:', glRendererStr || '(未知)', softGL ? '→ 软件渲染，按省电参数启动' : '');
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !softGL, premultipliedAlpha: false });
      renderer.setClearColor(0, 0);
      renderer.setPixelRatio(1); // buffer 分辨率由 updateBuffer 按窗口实际像素 ×SSAA 算
    } catch (e) {
      console.warn('[pet3d] WebGL 不可用，回退 2D 模式', e);
      syncAvailable(); // webglOk 仍 false → available false
      updateShape2D(); // 2D 回退：窗口贴整个 #app 容器
      resolveReady();
      console.timeEnd('[pet3d] 启动→首帧');
      return;
    }
    console.timeEnd('[pet3d] WebGL 初始化');
    webglOk = true;
    syncAvailable();
    canvas = renderer.domElement;
    canvas.id = 'pet3d';
    // canvas 铺满整个窗口：消灭「#app 反向平移 + canvas 偏移 + transform scale」坐标链
    canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;';
    stage.appendChild(canvas);
    apply3DLayout();

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, TARGET_H * 0.55, 8); // 占位朝向，包络算好后 fitCamera 重 fit
    camera.lookAt(0, TARGET_H * 0.5, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.2));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(2, 4, 3);
    scene.add(dir);

    glowMat = makeGlowMaterial();
    setGlowColor(glowColorName);
    scene.add(viewGroup); // viewGroup（观看角度）→ modelRoot（动作动画）
    viewGroup.add(modelRoot);

    updateBuffer();
    applyPerf(); // auto 档按 softGL 探测结果定初始参数（配置里的 perfMode 随后覆盖）

    // 窗口尺寸变化（win:shape 落地/系统缩放/外部因素）→ 重设 buffer + 重 fit 相机；
    // 外部因素（Windows DWM 边框随焦点漂移会把内容尺寸顶偏几到几十 px）不是我们发起的，
    // 会被 layout()/updateShape2D() 的目标守卫立即钉回目标尺寸（幂等，正常落地时不触发）。
    // 拖动进行中不响应：Win11 高缩放下反复 SetWindowPos 会让 DWM 逐次累积隐形边距
    //（窗口静默变大），这时 fitCamera 会把猫同步放大、win:shape 重锚定会让猫跳走
    //（「3D 拖动猫变大+位移」的病根）；dragEnd 统一 settle 一次
    window.addEventListener('resize', () => {
      if (!available) { updateShape2D(); return; }
      if (draggingMove) return;
      updateBuffer();
      fitCamera();
      layoutShadow();
      layout();
    });

    // WebGL 上下文丢失时故障回退 2D（userMode 不动）
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      webglOk = false;
      fallbackTo2D();
    });

    // 当前形象、流光颜色、视角、显示模式、清晰度（cake.js 可能已先设置过，这里读配置兜底）
    setCake(window.currentCakeId || 'cake01');
    window.api.getConfig().then((cfg) => {
      setGlowColor(cfg.glowColor);
      setViewAngle(cfg.viewYaw || 0, cfg.viewPitch || 0);
      if (cfg.gradeSat != null) gradeSat = cfg.gradeSat;
      if (cfg.gradeGamma != null) gradeGamma = cfg.gradeGamma;
      applyGrade();
      petSize = cfg.petSize || 240;
      if (cfg.perfCustomSSAA != null) perfCustomSSAA = cfg.perfCustomSSAA;
      if (cfg.perfCustomFPS != null) perfCustomFPS = cfg.perfCustomFPS;
      if (cfg.perfMode) { perfMode = cfg.perfMode; applyPerf(); }
      if (envBox) { computeEnvelope(); layout(); } // 档位与启动默认值不同时重贴窗口
      if (cfg.renderMode) setRenderMode(cfg.renderMode); // 启动时按配置决定 2D/3D
    });
    // 设置页实时生效：调色（浓郁度/深度）、视角滑块、显示模式开关
    window.api.onPrefsChanged((cfg) => {
      if (cfg.gradeSat != null) gradeSat = cfg.gradeSat;
      if (cfg.gradeGamma != null) gradeGamma = cfg.gradeGamma;
      applyGrade();
      if (cfg.viewYaw != null || cfg.viewPitch != null) {
        setViewAngle(cfg.viewYaw || 0, cfg.viewPitch || 0);
      }
      if (cfg.renderMode != null) setRenderMode(cfg.renderMode);
      if (cfg.perfCustomSSAA != null) perfCustomSSAA = cfg.perfCustomSSAA;
      if (cfg.perfCustomFPS != null) perfCustomFPS = cfg.perfCustomFPS;
      if (cfg.perfMode != null || cfg.perfCustomSSAA != null || cfg.perfCustomFPS != null) {
        if (cfg.perfMode != null) perfMode = cfg.perfMode;
        applyPerf();
      }
    });
    // petSize 变化 → 重算包络（px 余量按新档换算）→ 更新 buffer + 重 fit + 设一次窗口后冻结；
    // 2D 回退时由 cake.js applyZoom → refreshShape2D 处理
    window.api.onSizeChanged((px) => {
      petSize = px;
      if (!available) return;
      computeEnvelope();
      layout();
    });

    lastT = performance.now();
    rafId = requestAnimationFrame(loop);
    resolveReady();
    console.log('[pet3d] WebGL 初始化成功');
  }

  window.pet3d = {
    ready,
    get available() { return available; },
    setCake,
    play,
    glow(ms) { glowUntil = performance.now() + (ms || 1500); },
    hitTest,
    setGlowColor,
    setViewAngle,
    getViewAngle() { return { yaw: viewYaw, pitch: viewPitch }; },
    resetView() {
      setViewAngle(0, 0);
      window.api.setConfig({ viewYaw: 0, viewPitch: 0 });
    },
    // 表情层：眯眼笑等保持表情（'CloseEye'），复位回待机眼睑
    setExpression,
    clearExpression,
    // 官方剪辑是否可用（接线方降级用）
    hasClip(key) { return !!officialClips[key]; },
    // 拖动窗口走路：interact.js 在拖动开始/结束时调，拖动中每个位移调 dragPulse
    dragStart,
    dragEnd,
    dragPulse,
    // 旋转拖动结束时持久化（interact.js 在 mouseup 调）
    saveViewAngle() {
      window.api.setConfig({ viewYaw, viewPitch });
    },
    // 2D 回退专用：applyZoom 缩放 #app 后重贴窗口（3D 模式窗口由 layout() 驱动）
    refreshShape2D() {
      if (!available) updateShape2D();
    },
    // 显示模式开关（renderMode 配置）：'3d' | '2d'，可逆切换
    setRenderMode,
    get renderMode() { return userMode; },
    // 动画冻结（capture-front.py 截图用）：true 时所有动画/浮动静止，渲染继续
    setAnimFrozen(v) { animFrozen = !!v; },
    // 调试开关：模拟软渲染（CDP 验证 auto→saver 链路用）
    _forceSoftGL(v) { softGL = !!v; applyPerf(); },
    // 验收/排查用：当前包络与取景参数 + GL 渲染器/性能模式（弱机排障让用户发这个）
    debugInfo() {
      const effMode = perfMode === 'auto' ? (softGL ? 'saver' : 'high') : perfMode;
      return { envBox, restTop, PX, petSize, win: [window.innerWidth, window.innerHeight],
        chainRunning, procRunning: !!curAction, moving: !!(moveLoopAction || moveStarting), exprHold: !!exprHold,
        glRenderer: glRendererStr, softGL, perfMode, effMode, effSSAA,
        fpsCap: frameInterval ? Math.round(1000 / frameInterval) : 60, frameCount };
    },
    // 官方动画验收用：已加载剪辑清单 + 动作语义映射（实机观感校准后改 OFFICIAL_ACTION_MAP）
    anims() {
      return { official: Object.keys(officialClips), map: OFFICIAL_ACTION_MAP, standby: !!standbyAction };
    },
  };

  init();
})();
