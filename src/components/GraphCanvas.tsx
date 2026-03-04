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
  PerspectiveCamera,
  Scene,
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
  selectedSlug,
  onSelectNode,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

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

    const onPointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    renderer.domElement.addEventListener("pointermove", onPointerMove);

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

    renderer.domElement.addEventListener("click", onClick);

    const animate = () => {
      frame += 1;

      simulate();
      updateEdges();

      rootGroup.rotation.y += 0.0003;

      highlightHover();

      renderer.render(scene, camera);
      animationId = window.requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, [graph, onSelectNode, selectedSlug]);

  return <div ref={containerRef} />;
}

