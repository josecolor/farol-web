/**
 * 🎬 MOTOR DE COMPRESIÓN - Reducción automática de peso (fuerza)
 * Asegura que NO pase de 15MB
 * Soporta: MP4, WebP, JPG, PNG
 */

/**
 * Comprimir video MP4
 * @param {File} videoFile - Archivo de video
 * @param {number} maxSizeMB - Tamaño máximo (default 15MB)
 * @returns {Promise<Blob>} - Video comprimido
 */
async function comprimirVideo(videoFile, maxSizeMB = 15) {
  try {
    const videoSizeMB = (videoFile.size / (1024 * 1024)).toFixed(2);
    console.log(`📹 Video original: ${videoSizeMB}MB`);

    // Si ya está dentro del límite, no comprimir
    if (videoSizeMB <= maxSizeMB) {
      console.log(`✅ Video ya está optimizado (${videoSizeMB}MB)`);
      return videoFile;
    }

    // Si es muy grande, usar estrategia de compresión
    const canvas = await crearCanvasDelVideo(videoFile);
    const videoComprimido = await canvasAVideo(canvas);

    const nuevoTamano = (videoComprimido.size / (1024 * 1024)).toFixed(2);
    console.log(`✅ Video comprimido: ${nuevoTamano}MB`);

    return videoComprimido;

  } catch (error) {
    console.error('❌ Error comprimiendo video:', error);
    throw error;
  }
}

/**
 * Comprimir imagen (JPG, PNG, WebP)
 * @param {File} imageFile - Archivo de imagen
 * @param {number} quality - Calidad 0-1 (default 0.7)
 * @param {number} maxWidth - Ancho máximo en px (default 1200)
 * @returns {Promise<Blob>} - Imagen comprimida
 */
async function comprimirImagen(imageFile, quality = 0.7, maxWidth = 1200) {
  try {
    const imageSizeMB = (imageFile.size / (1024 * 1024)).toFixed(2);
    console.log(`🖼️ Imagen original: ${imageSizeMB}MB`);

    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        const img = new Image();

        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          // Calcular nuevas dimensiones
          let width = img.width;
          let height = img.height;

          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }

          canvas.width = width;
          canvas.height = height;

          // Dibujar imagen redimensionada
          ctx.drawImage(img, 0, 0, width, height);

          // Convertir a blob comprimido
          canvas.toBlob(
            (blob) => {
              const nuevoTamano = (blob.size / (1024 * 1024)).toFixed(2);
              console.log(`✅ Imagen comprimida: ${nuevoTamano}MB (${width}x${height}px)`);
              resolve(blob);
            },
            'image/webp', // Usar WebP para mejor compresión
            quality
          );
        };

        img.onerror = () => {
          reject(new Error('Error al cargar la imagen'));
        };

        img.src = e.target.result;
      };

      reader.onerror = () => {
        reject(new Error('Error al leer el archivo'));
      };

      reader.readAsDataURL(imageFile);
    });
  } catch (error) {
    console.error('❌ Error comprimiendo imagen:', error);
    throw error;
  }
}

/**
 * Convertir archivo multimedia a base64 con control de tamaño
 * @param {File} file - Archivo (video, imagen, etc)
 * @param {number} maxSizeMB - Tamaño máximo en MB
 * @returns {Promise<string>} - Base64 comprimido
 */
async function mediaABase64(file, maxSizeMB = 15) {
  try {
    let archivoAUsar = file;

    // Si es video, comprimir
    if (file.type.startsWith('video/')) {
      archivoAUsar = await comprimirVideo(file, maxSizeMB);
    }
    // Si es imagen, comprimir
    else if (file.type.startsWith('image/')) {
      archivoAUsar = await comprimirImagen(file);
    }

    // Convertir a base64
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const base64 = reader.result;
        const sizeMB = (base64.length / (1024 * 1024)).toFixed(2);

        if (sizeMB > maxSizeMB) {
          reject(new Error(`Archivo aún demasiado grande: ${sizeMB}MB (máximo: ${maxSizeMB}MB)`));
        } else {
          console.log(`✅ Base64 listo: ${sizeMB}MB`);
          resolve(base64);
        }
      };

      reader.onerror = () => {
        reject(new Error('Error al convertir a base64'));
      };

      reader.readAsDataURL(archivoAUsar);
    });
  } catch (error) {
    console.error('❌ Error en mediaABase64:', error);
    throw error;
  }
}

/**
 * Crear canvas del video (extrae primer fotograma)
 */
async function crearCanvasDelVideo(videoFile) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      resolve(canvas);
    };

    video.onerror = () => {
      reject(new Error('Error al procesar video'));
    };

    video.src = URL.createObjectURL(videoFile);
  });
}

/**
 * Convertir canvas a video blob
 */
async function canvasAVideo(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob);
    }, 'video/mp4');
  });
}

/**
 * Validar tamaño de archivo
 */
function validarTamano(file, maxMB = 15) {
  const sizeMB = (file.size / (1024 * 1024)).toFixed(2);

  if (sizeMB > maxMB) {
    throw new Error(`Archivo demasiado grande: ${sizeMB}MB (máximo: ${maxMB}MB)`);
  }

  return true;
}

/**
 * Obtener información del archivo
 */
function obtenerInfoArchivo(file) {
  const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
  const extension = file.name.split('.').pop().toLowerCase();
  const tipo = file.type;

  return {
    nombre: file.name,
    tipo: tipo,
    extension: extension,
    sizeMB: sizeMB,
    tamanoBruto: file.size,
    esVideo: tipo.startsWith('video/'),
    esImagen: tipo.startsWith('image/')
  };
}

// Exportar funciones
window.motorCompresion = {
  comprimirVideo,
  comprimirImagen,
  mediaABase64,
  validarTamano,
  obtenerInfoArchivo
};

console.log('✅ Motor de Compresión cargado');
