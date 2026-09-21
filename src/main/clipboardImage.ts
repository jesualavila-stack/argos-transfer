import { nativeImage, type NativeImage } from 'electron'
import { LIVE_IMAGE_MAX_EDGE, LIVE_JPEG_QUALITY, LIVE_MAX_IMAGE_BYTES } from '../shared/constants'

export function compressClipboardImage(image: NativeImage): string | null {
  if (image.isEmpty()) return null
  const size = image.getSize()
  let working = image
  const longest = Math.max(size.width, size.height)
  if (longest > LIVE_IMAGE_MAX_EDGE) {
    const scale = LIVE_IMAGE_MAX_EDGE / longest
    working = image.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: 'better'
    })
  }

  let quality = LIVE_JPEG_QUALITY
  let jpeg = working.toJPEG(quality)
  while (jpeg.length > LIVE_MAX_IMAGE_BYTES && quality > 40) {
    quality -= 8
    jpeg = working.toJPEG(quality)
  }
  if (jpeg.length > LIVE_MAX_IMAGE_BYTES) {
    const smaller = working.resize({
      width: Math.max(1, Math.round(working.getSize().width * 0.7)),
      height: Math.max(1, Math.round(working.getSize().height * 0.7)),
      quality: 'better'
    })
    jpeg = smaller.toJPEG(55)
  }
  if (jpeg.length > LIVE_MAX_IMAGE_BYTES) return null
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`
}

export function imageFromDataUrl(dataUrl: string): NativeImage | null {
  try {
    const image = nativeImage.createFromDataURL(dataUrl)
    return image.isEmpty() ? null : image
  } catch {
    return null
  }
}
