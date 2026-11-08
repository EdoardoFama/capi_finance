import sharp from 'sharp';

async function removeWhiteBackground() {
  const image = sharp('logo_capivara.jpg');
  const metadata = await image.metadata();
  const { width, height } = metadata;

  // Pegar raw RGBA
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  // A logo tem fundo quase branco puro (R, G, B > 240)
  // Vamos fazer flood-fill ou máscara a partir das bordas para não remover nada de dentro
  const visited = new Uint8Array(width * height);
  const queue = [];

  const getIdx = (x, y) => (y * width + x) * 4;
  const isBgCandidate = (x, y) => {
    const idx = getIdx(x, y);
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    // Se for muito claro / esbranquiçado
    return r > 238 && g > 238 && b > 238;
  };

  // Iniciar flood fill das 4 bordas
  for (let x = 0; x < width; x++) {
    if (isBgCandidate(x, 0)) { visited[0 * width + x] = 1; queue.push(x, 0); }
    if (isBgCandidate(x, height - 1)) { visited[(height - 1) * width + x] = 1; queue.push(x, height - 1); }
  }
  for (let y = 0; y < height; y++) {
    if (isBgCandidate(0, y)) { visited[y * width + 0] = 1; queue.push(0, y); }
    if (isBgCandidate(width - 1, y)) { visited[y * width + (width - 1)] = 1; queue.push(width - 1, y); }
  }

  let head = 0;
  while (head < queue.length) {
    const cx = queue[head++];
    const cy = queue[head++];

    const neighbors = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1]
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const npos = ny * width + nx;
        if (!visited[npos] && isBgCandidate(nx, ny)) {
          visited[npos] = 1;
          queue.push(nx, ny);
        }
      }
    }
  }

  // Agora definir alpha = 0 para todos os pixels visitados pelo flood fill
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = y * width + x;
      const idx = pos * 4;
      if (visited[pos]) {
        data[idx + 3] = 0; // Transparente
      }
    }
  }

  // Salvar imagem transparente e fazer trim automático
  const transparentPng = await sharp(data, {
    raw: {
      width,
      height,
      channels: 4
    }
  })
  .trim()
  .toFormat('png')
  .toBuffer();

  // Salvar a logo recortada e transparente em public/logo.png
  await sharp(transparentPng).toFile('public/logo.png');

  // Gerar ícones PWA e favicon com a capivara
  await sharp(transparentPng).resize(192, 192, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toFile('public/icons/icon-192.png');
  await sharp(transparentPng).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toFile('public/icons/icon-512.png');
  await sharp(transparentPng).resize(180, 180, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toFile('public/icons/apple-touch-icon.png');

  console.log('Logo processada com sucesso!');
}

removeWhiteBackground().catch(console.error);
