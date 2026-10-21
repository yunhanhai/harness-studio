import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = process.cwd()
const source = join(root, 'resources', 'brand.svg')
const tmp = join(root, '.icon-build')

await mkdir(tmp, { recursive: true })
await mkdir(join(root, 'build'), { recursive: true })

async function render(size) {
  const file = join(tmp, `icon-${size}.png`)
  await sharp(source, { density: 384 }).resize(size, size).png().toFile(file)
  return file
}

await sharp(source, { density: 512 }).resize(1024, 1024).png().toFile(join(root, 'resources', 'icon.png'))
const tray = await render(32)
await sharp(tray).toFile(join(root, 'resources', 'tray.png'))

const sizes = [16, 24, 32, 48, 64, 128, 256]
const files = []
for (const size of sizes) files.push(await render(size))

const ico = await pngToIco(files)
await writeFile(join(root, 'build', 'icon.ico'), ico)
await writeFile(join(root, 'resources', 'icon.ico'), ico)
await writeFile(join(root, 'build', 'icon.png'), await sharp(source, { density: 512 }).resize(512, 512).png().toBuffer())

await rm(tmp, { recursive: true, force: true })
console.log('icons generated: resources/icon.png, resources/tray.png, build/icon.ico')
