"use client";

import { useEffect, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Points,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  Raycaster,
} from "three";
import type { GraphData } from "@/lib/vault";

interface GraphCanvasProps {
  graph: GraphData;
  selectedSlug: string | null;
  onSelectNode(slug: string | null): void;
}

interface NodeVisual {
  slug: string;
  mesh: Mesh;
  baseColor: Color;
  strength: number;
  position: Vector3;
  previous: Vector3;
  acceleration: Vector3;
  radius: number;
}

interface EdgeVisual {
  sourceIndex: number;
  targetIndex: number;
  line: Line;
  opacityBase: number;
}

export default function GraphCanvas({
  graph,
  onSelectNode,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || !inputRef.current) return;

    const scene = new Scene();
    const renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setClearColor(0x000000, 1);

    const container = containerRef.current;
    container.appendChild(renderer.domElement);
    renderer.domElement.classList.add("creature-canvas");

    let width = window.innerWidth;
    let height = window.innerHeight;

    const camera = new PerspectiveCamera(45, width / height, 0.1, 5000);
    camera.position.set(0, 0, 900);

    const rootGroup = new Group();
    scene.add(rootGroup);

    const nodes: NodeVisual[] = [];
    const edges: EdgeVisual[] = [];

    const nodeIndexBySlug = new Map<string, number>();

    const nodeGeo = new SphereGeometry(1, 16, 16);

    const minRadius = 3;
    const maxRadius = 18;
    let minBacklinks = Infinity;
    let maxBacklinks = -Infinity;
    for (const node of graph.nodes) {
      minBacklinks = Math.min(minBacklinks, node.backlinkCount);
      maxBacklinks = Math.max(maxBacklinks, node.backlinkCount);
    }
    if (!Number.isFinite(minBacklinks)) {
      minBacklinks = 0;
      maxBacklinks = 1;
    }

    const mapRadius = (count: number) => {
      if (maxBacklinks === minBacklinks) return (minRadius + maxRadius) / 2;
      const t = (count - minBacklinks) / (maxBacklinks - minBacklinks);
      return minRadius + t * (maxRadius - minRadius);
    };

    const colorForNode = (status: string, type: string): Color => {
      if (type === "essay") {
        return new Color("#e8ff00");
      }
      if (status === "evergreen") {
        return new Color("#00ffd1");
      }
      const base = new Color("#ffffff");
      if (status === "seedling") {
        return base.multiplyScalar(0.4);
      }
      if (status === "budding") {
        return base.multiplyScalar(0.7);
      }
      return base;
    };

    graph.nodes.forEach((node, index) => {
      const radius = mapRadius(node.backlinkCount);
      const color = colorForNode(node.status, node.type);

      const material = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: node.type === "essay" ? 1.0 : color.equals(new Color("#ffffff")) ? 0.7 : 0.9,
      });

      const mesh = new Mesh(nodeGeo, material);

      const angle = (index / Math.max(1, graph.nodes.length)) * Math.PI * 2;
      const r = 200 + Math.random() * 200;
      const pos = new Vector3(
        Math.cos(angle) * r,
        (Math.random() - 0.5) * 200,
        Math.sin(angle) * r
      );

      mesh.position.copy(pos);
      mesh.scale.setScalar(radius);

      rootGroup.add(mesh);

      nodes.push({
        slug: node.slug,
        mesh,
        baseColor: color,
        strength: 1,
        position: pos.clone(),
        previous: pos.clone(),
        acceleration: new Vector3(),
        radius,
      });
      nodeIndexBySlug.set(node.slug, index);
    });

    const edgeMaterialBase = new LineBasicMaterial({
      color: new Color("#ffffff"),
      transparent: true,
      opacity: 0.08,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    const edgeSamples = 16;

    graph.edges.forEach((edge) => {
      const sourceIndex = nodeIndexBySlug.get(edge.source);
      const targetIndex = nodeIndexBySlug.get(edge.target);
      if (
        sourceIndex === undefined ||
        targetIndex === undefined ||
        sourceIndex === targetIndex
      ) {
        return;
      }

      const positions = new Float32Array(edgeSamples * 3);
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(positions, 3));

      const material = edgeMaterialBase.clone();

      const line = new Line(geometry, material);
      rootGroup.add(line);

      edges.push({
        sourceIndex,
        targetIndex,
        line,
        opacityBase: 0.08,
      });
    });

    const raycaster = new Raycaster();
    const mouse = new Vector2();
    let hoveredIndex: number | null = null;
    const hoveredWorld = new Vector3();
    let wakeTarget = 0;
    let wakeCurrent = 0;

    const makeParticleMaterial = () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uPixelRatio: { value: window.devicePixelRatio || 1 },
          uGlobalAlpha: { value: 1 },
        },
        vertexShader: `
          attribute vec3 color;
          attribute float aSize;
          attribute float aAlpha;
          uniform float uPixelRatio;
          uniform float uGlobalAlpha;
          varying vec3 vColor;
          varying float vAlpha;

          void main() {
            vColor = color;
            vAlpha = aAlpha * uGlobalAlpha;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            gl_PointSize = aSize * uPixelRatio;
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            vec2 c = gl_PointCoord - vec2(0.5);
            float d = length(c);
            float mask = 1.0 - smoothstep(0.45, 0.5, d);
            gl_FragColor = vec4(vColor, vAlpha * mask);
          }
        `,
      });

    // Dormant creature: two organs at screen edges (dim)
    const creatureOrgans = [
      {
        center: new Vector3(-520, 0, 0),
        baseRadius: 120,
        phase: Math.random() * Math.PI * 2,
      },
      {
        center: new Vector3(520, 0, 0),
        baseRadius: 120,
        phase: Math.random() * Math.PI * 2,
      },
    ];

    const creatureParticles = 6000;
    const creatureGeometry = new BufferGeometry();
    const creaturePositions = new Float32Array(creatureParticles * 3);
    const creatureOffsets = new Float32Array(creatureParticles * 3);
    const creatureColors = new Float32Array(creatureParticles * 3);
    const creatureSizes = new Float32Array(creatureParticles);
    const creatureAlpha = new Float32Array(creatureParticles);
    const creatureOrganIndex = new Uint8Array(creatureParticles);

    for (let i = 0; i < creatureParticles; i++) {
      const o = i < creatureParticles / 2 ? 0 : 1;
      creatureOrganIndex[i] = o;
      const organ = creatureOrgans[o];
      const theta = Math.random() * Math.PI * 2;
      const r = organ.baseRadius * (0.25 + Math.random() * 0.75);
      const ex = Math.cos(theta) * r;
      const ey = Math.sin(theta) * (r * (0.6 + Math.random() * 0.4));
      const idx3 = i * 3;
      creatureOffsets[idx3] = ex;
      creatureOffsets[idx3 + 1] = ey;
      creatureOffsets[idx3 + 2] = 0;
      creaturePositions[idx3] = organ.center.x + ex;
      creaturePositions[idx3 + 1] = organ.center.y + ey;
      creaturePositions[idx3 + 2] = 0;

      const edgeFactor = Math.min(1, Math.sqrt((ex * ex + ey * ey) / (organ.baseRadius * organ.baseRadius)));
      const mixed = new Color(0x00ffd1).lerp(new Color(0xffffff), edgeFactor);
      creatureColors[idx3] = mixed.r;
      creatureColors[idx3 + 1] = mixed.g;
      creatureColors[idx3 + 2] = mixed.b;

      creatureAlpha[i] = 1;
      creatureSizes[i] = 1.0 + Math.random() * 0.8;
    }

    creatureGeometry.setAttribute(
      "position",
      new BufferAttribute(creaturePositions, 3)
    );
    creatureGeometry.setAttribute("color", new BufferAttribute(creatureColors, 3));
    creatureGeometry.setAttribute("aSize", new BufferAttribute(creatureSizes, 1));
    creatureGeometry.setAttribute("aAlpha", new BufferAttribute(creatureAlpha, 1));

    const creatureMaterial = makeParticleMaterial();
    creatureMaterial.uniforms.uGlobalAlpha.value = 0.2;
    const creaturePoints = new Points(creatureGeometry, creatureMaterial);
    scene.add(creaturePoints);

    const podPerSide = 200;
    const podParticles = podPerSide * 2;
    const podGeometry = new BufferGeometry();
    const podPositions = new Float32Array(podParticles * 3);
    const podColors = new Float32Array(podParticles * 3);
    const podSizes = new Float32Array(podParticles);
    const podAlpha = new Float32Array(podParticles);
    for (let i = 0; i < podParticles; i++) {
      const idx3 = i * 3;
      podPositions[idx3] = -10000;
      podPositions[idx3 + 1] = -10000;
      podPositions[idx3 + 2] = 0;
      podColors[idx3] = 1;
      podColors[idx3 + 1] = 1;
      podColors[idx3 + 2] = 1;
      podAlpha[i] = 0.6;
      podSizes[i] = 1.0 + Math.random() * 0.6;
    }
    podGeometry.setAttribute("position", new BufferAttribute(podPositions, 3));
    podGeometry.setAttribute("color", new BufferAttribute(podColors, 3));
    podGeometry.setAttribute("aSize", new BufferAttribute(podSizes, 1));
    podGeometry.setAttribute("aAlpha", new BufferAttribute(podAlpha, 1));
    const podMaterial = makeParticleMaterial();
    podMaterial.uniforms.uGlobalAlpha.value = 0;
    const podPoints = new Points(podGeometry, podMaterial);
    scene.add(podPoints);

    const onPointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    inputRef.current.addEventListener("pointermove", onPointerMove);

    let frame = 0;
    let animationId: number;

    const simulate = () => {
      const dt = 0.016;
      const dt2 = dt * dt;
      const damping = 0.9;

      for (const n of nodes) {
        n.acceleration.set(0, 0, 0);
      }

      const repulsion = 1800;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const delta = new Vector3().subVectors(a.position, b.position);
          const distSq = Math.max(50, delta.lengthSq());
          const force = repulsion / distSq;
          delta.normalize().multiplyScalar(force);
          a.acceleration.add(delta);
          b.acceleration.sub(delta);
        }
      }

      const spring = 0.01;
      const restLength = 220;
      for (const e of edges) {
        const a = nodes[e.sourceIndex];
        const b = nodes[e.targetIndex];
        const delta = new Vector3().subVectors(b.position, a.position);
        const dist = Math.max(10, delta.length());
        const stretch = dist - restLength;
        delta.normalize().multiplyScalar(spring * stretch);
        a.acceleration.add(delta);
        b.acceleration.sub(delta);
      }

      const centerForce = 0.002;
      for (const n of nodes) {
        const toCenter = n.position.clone().multiplyScalar(-centerForce);
        n.acceleration.add(toCenter);
      }

      for (const n of nodes) {
        const current = n.position.clone();
        const velocity = n.position.clone().sub(n.previous).multiplyScalar(damping);
        const next = n.position
          .clone()
          .add(velocity)
          .add(n.acceleration.clone().multiplyScalar(dt2));
        n.previous.copy(current);
        n.position.copy(next);
        n.mesh.position.copy(next);
      }
    };

    const updateEdges = () => {
      for (const e of edges) {
        const a = nodes[e.sourceIndex].position;
        const b = nodes[e.targetIndex].position;
        const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
        const dir = new Vector3().subVectors(b, a);
        const perp = new Vector3(-dir.z, 0, dir.x).normalize();
        const c1 = new Vector3().addVectors(mid, perp.clone().multiplyScalar(40));
        const c2 = new Vector3().addVectors(mid, perp.clone().multiplyScalar(-40));

        const curve = new CatmullRomCurve3([a, c1, c2, b]);

        const positionAttr = e.line.geometry.getAttribute(
          "position"
        ) as BufferAttribute;
        for (let i = 0; i < edgeSamples; i++) {
          const t = i / (edgeSamples - 1);
          const point = curve.getPoint(t);
          positionAttr.setXYZ(i, point.x, point.y, point.z);
        }
        positionAttr.needsUpdate = true;
      }
    };

    const highlightHover = () => {
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(
        nodes.map((n) => n.mesh),
        false
      );

      let newHovered: number | null = null;
      if (intersects.length > 0) {
        const mesh = intersects[0].object as Mesh;
        newHovered = nodes.findIndex((n) => n.mesh === mesh);
      }

      if (newHovered === hoveredIndex) return;

      hoveredIndex = newHovered;
      wakeTarget = hoveredIndex === null ? 0 : 1;
      if (hoveredIndex !== null) {
        nodes[hoveredIndex].mesh.getWorldPosition(hoveredWorld);
      }

      nodes.forEach((n, index) => {
        const mat = n.mesh.material as MeshBasicMaterial;
        if (index === hoveredIndex) {
          mat.opacity = 1.0;
        } else {
          mat.opacity = n.mesh.userData.baseOpacity ?? mat.opacity;
        }
        mat.needsUpdate = true;
      });

      edges.forEach((e) => {
        const mat = e.line.material as LineBasicMaterial;
        if (
          hoveredIndex !== null &&
          (e.sourceIndex === hoveredIndex || e.targetIndex === hoveredIndex)
        ) {
          mat.opacity = 0.4;
        } else {
          mat.opacity = e.opacityBase;
        }
        mat.needsUpdate = true;
      });
    };

    nodes.forEach((n) => {
      const mat = n.mesh.material as MeshBasicMaterial;
      n.mesh.userData.baseOpacity = mat.opacity;
    });

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    resize();
    window.addEventListener("resize", resize);

    const onClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      const clickMouse = new Vector2(x, y);
      raycaster.setFromCamera(clickMouse, camera);
      const intersects = raycaster.intersectObjects(
        nodes.map((n) => n.mesh),
        false
      );
      if (intersects.length > 0) {
        const mesh = intersects[0].object as Mesh;
        const node = nodes.find((n) => n.mesh === mesh);
        if (node) {
          onSelectNode(node.slug);
          return;
        }
      }
      onSelectNode(null);
    };

    inputRef.current.addEventListener("click", onClick);

    const animate = () => {
      frame += 1;
      const t = frame / 60;

      simulate();
      updateEdges();

      rootGroup.rotation.y += 0.0003;

      highlightHover();

      // Dormant/waking creature update
      wakeCurrent += (wakeTarget - wakeCurrent) * 0.08; // ~0.8s to converge
      creatureMaterial.uniforms.uGlobalAlpha.value = 0.2 + 0.8 * wakeCurrent;
      podMaterial.uniforms.uGlobalAlpha.value = wakeCurrent;

      for (let i = 0; i < creatureParticles; i++) {
        const organ = creatureOrgans[creatureOrganIndex[i]];
        const idx3 = i * 3;
        const ex = creatureOffsets[idx3];
        const ey = creatureOffsets[idx3 + 1];
        const pulse = 1 + 0.06 * Math.sin(t * 0.6 + organ.phase);
        creaturePositions[idx3] = organ.center.x + ex * pulse;
        creaturePositions[idx3 + 1] = organ.center.y + ey * pulse;
        creaturePositions[idx3 + 2] = 0;
      }
      (creatureGeometry.getAttribute("position") as BufferAttribute).needsUpdate =
        true;

      if (hoveredIndex !== null) {
        const target = hoveredWorld;
        for (let side = 0; side < 2; side++) {
          const start = creatureOrgans[side].center;
          const baseIndex = side * podPerSide;
          const dir = new Vector3().subVectors(target, start);
          const len = Math.max(1, dir.length());
          dir.multiplyScalar(1 / len);
          const perp1 = new Vector3().crossVectors(dir, new Vector3(0, 1, 0)).normalize();
          const perp2 = new Vector3().crossVectors(dir, perp1).normalize();

          for (let i = 0; i < podPerSide; i++) {
            const idx = baseIndex + i;
            const idx3 = idx * 3;
            const baseT = i / (podPerSide - 1);
            const extendT = baseT * wakeCurrent;
            const px = start.x + (target.x - start.x) * extendT;
            const py = start.y + (target.y - start.y) * extendT;
            const pz = start.z + (target.z - start.z) * extendT;

            let ox = 0;
            let oy = 0;
            let oz = 0;
            if (baseT > 0.85) {
              const tip = (baseT - 0.85) / 0.15;
              const angle = t * 0.6 + i * 0.1 + side;
              const r = 10 * tip;
              const orbit = perp1
                .clone()
                .multiplyScalar(Math.cos(angle) * r)
                .add(perp2.clone().multiplyScalar(Math.sin(angle) * r));
              ox = orbit.x;
              oy = orbit.y;
              oz = orbit.z;
            }

            podPositions[idx3] = px + ox;
            podPositions[idx3 + 1] = py + oy;
            podPositions[idx3 + 2] = pz + oz;
          }
        }
      } else {
        for (let i = 0; i < podParticles; i++) {
          const idx3 = i * 3;
          podPositions[idx3] = -10000;
          podPositions[idx3 + 1] = -10000;
          podPositions[idx3 + 2] = 0;
        }
      }
      (podGeometry.getAttribute("position") as BufferAttribute).needsUpdate = true;

      renderer.render(scene, camera);
      animationId = window.requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
      inputRef.current?.removeEventListener("pointermove", onPointerMove);
      inputRef.current?.removeEventListener("click", onClick);
      scene.remove(creaturePoints);
      scene.remove(podPoints);
      creatureGeometry.dispose();
      podGeometry.dispose();
      creatureMaterial.dispose();
      podMaterial.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, [graph, onSelectNode]);

  return (
    <>
      <div ref={containerRef} />
      <div ref={inputRef} className="graph-input-layer" />
    </>
  );
}

