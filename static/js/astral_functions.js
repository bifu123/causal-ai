// 创建恒星（贞节点）
function createStar(THREE, color, node) {
    const group = new THREE.Group();
    
    // 1. 核心球体 - 发光效果
    const coreGeometry = new THREE.SphereGeometry(1, 32, 32);
    const coreMaterial = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.9
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    group.add(core);
    
    // 2. 光晕效果 - 更大的半透明球体
    const haloGeometry = new THREE.SphereGeometry(1.3, 32, 32);
    const haloMaterial = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.3,
        side: THREE.BackSide
    });
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    group.add(halo);
    
    // 3. 光晕动画
    let time = 0;
    function animateHalo() {
        time += 0.05;
        const scale = 1 + 0.1 * Math.sin(time);
        halo.scale.set(scale, scale, scale);
        halo.material.opacity = 0.3 + 0.1 * Math.sin(time * 0.5);
        requestAnimationFrame(animateHalo);
    }
    animateHalo();
    
    return group;
}

// 创建气态行星（又贞节点）
function createGasGiant(THREE, color, node) {
    const group = new THREE.Group();
    
    // 1. 行星主体 - 云层效果
    const planetGeometry = new THREE.SphereGeometry(1, 32, 32);
    const planetMaterial = new THREE.MeshPhongMaterial({
        color: color,
        shininess: 10,
        transparent: true,
        opacity: 0.9
    });
    const planet = new THREE.Mesh(planetGeometry, planetMaterial);
    group.add(planet);
    
    // 2. 行星环
    const ringGeometry = new THREE.RingGeometry(1.5, 2.5, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xaaaaaa,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2; // 水平放置
    group.add(ring);
    
    // 3. 旋转动画
    let time = 0;
    function animateRotation() {
        time += 0.01;
        planet.rotation.y = time;
        ring.rotation.z = time * 0.5;
        requestAnimationFrame(animateRotation);
    }
    animateRotation();
    
    return group;
}

// 创建岩质行星（对贞节点）
function createRockyPlanet(THREE, color, node) {
    const group = new THREE.Group();
    
    // 1. 行星主体 - 岩石纹理效果
    const planetGeometry = new THREE.SphereGeometry(1, 32, 32);
    
    // 创建岩石纹理（使用噪声模拟）
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    
    // 绘制岩石纹理
    ctx.fillStyle = "rgb(" + 
        Math.floor((color >> 16) & 0xFF) + "," +
        Math.floor((color >> 8) & 0xFF) + "," +
        Math.floor(color & 0xFF) + ")";
    ctx.fillRect(0, 0, 256, 256);
    
    // 添加岩石纹理细节
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    for (let i = 0; i < 100; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const size = Math.random() * 10 + 5;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // 添加亮点
    ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
    for (let i = 0; i < 50; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const size = Math.random() * 5 + 2;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    
    const planetMaterial = new THREE.MeshPhongMaterial({
        map: texture,
        shininess: 5,
        bumpScale: 0.05
    });
    
    const planet = new THREE.Mesh(planetGeometry, planetMaterial);
    group.add(planet);
    
    // 2. 缓慢旋转
    let time = 0;
    function animateRotation() {
        time += 0.005;
        planet.rotation.y = time;
        requestAnimationFrame(animateRotation);
    }
    animateRotation();
    
    return group;
}

// 创建文本标签
function createTextLabel(THREE, node) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    
    // 设置文本
    const text = node.id ? node.id.toString().substring(0, 8) : "N/A";
    const fontSize = 20;
    const fontFamily = "Arial, sans-serif";
    const font = "bold " + fontSize + "px " + fontFamily;
    
    // 测量文本
    context.font = font;
    const textWidth = context.measureText(text).width;
    
    // 设置画布大小
    canvas.width = textWidth + 10;
    canvas.height = fontSize + 6;
    
    // 重新设置字体
    context.font = font;
    context.textAlign = "center";
    context.textBaseline = "middle";
    
    // 绘制背景
    context.fillStyle = "rgba(0, 0, 0, 0.7)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    // 绘制文本
    context.fillStyle = "#ffffff";
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    
    // 创建纹理
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    
    // 创建精灵材质
    const spriteMaterial = new THREE.SpriteMaterial({ 
        map: texture,
        transparent: true,
        opacity: 0.9
    });
    
    // 创建精灵
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(canvas.width / 100, canvas.height / 100, 1);
    sprite.position.set(0, 1.8, 0);
    
    return sprite;
}
