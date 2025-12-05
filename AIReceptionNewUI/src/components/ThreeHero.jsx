import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function ThreeHero() {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let mouseX = 0;
    let mouseY = 0;
    const lerp = (a, b, t) => a + (b - a) * t;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0c2f, 8, 26);

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    camera.position.set(0, 0.2, 9);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);

    const keyLight = new THREE.PointLight(0x8a7bff, 1.2, 30);
    keyLight.position.set(6, 6, 6);
    scene.add(keyLight);

    const fillLight = new THREE.PointLight(0x5ddcff, 1, 30);
    fillLight.position.set(-6, -4, 4);
    scene.add(fillLight);

    const geometry = new THREE.IcosahedronGeometry(2.2, 1);
    const material = new THREE.MeshStandardMaterial({
      color: 0x3a2a8a,
      metalness: 0.65,
      roughness: 0.25,
      emissive: 0x151832,
      emissiveIntensity: 0.4
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const wireMaterial = new THREE.LineBasicMaterial({
      color: 0x8bf1ff,
      transparent: true,
      opacity: 0.35
    });
    const wireframe = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      wireMaterial
    );
    mesh.add(wireframe);

    const starsGeometry = new THREE.BufferGeometry();
    const starCount = 320;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 40;
      positions[i + 1] = (Math.random() - 0.5) * 30;
      positions[i + 2] = (Math.random() - 0.5) * 20 - 6;
    }
    starsGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const starsMaterial = new THREE.PointsMaterial({
      color: 0x8a9cff,
      size: 0.05,
      transparent: true,
      opacity: 0.7
    });
    const stars = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(stars);

    let animationFrame;
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const targetRotX = mouseY * 0.25;
      const targetRotY = mouseX * 0.35;

      mesh.rotation.x = lerp(mesh.rotation.x, targetRotX, 0.08);
      mesh.rotation.y = lerp(mesh.rotation.y, targetRotY, 0.08);
      const time = performance.now() * 0.001;
      wireframe.rotation.x = mesh.rotation.x + Math.sin(time * 0.6) * 0.1;
      wireframe.rotation.y = mesh.rotation.y + time * 0.35;
      stars.rotation.y += 0.0006;
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const { clientWidth, clientHeight } = container;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight);
    };

    const handlePointerMove = (event) => {
      const rect = container.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      mouseX = (x - 0.5) * 2;
      mouseY = (y - 0.5) * 2;
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("pointermove", handlePointerMove);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("pointermove", handlePointerMove);
      geometry.dispose();
      wireMaterial.dispose();
      starsGeometry.dispose();
      starsMaterial.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div className="three-shell" ref={containerRef} aria-hidden="true" />;
}
