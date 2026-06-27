from PIL import Image, ImageDraw

scale = 4
size = 256 * scale
img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

draw.rounded_rectangle([8*scale, 8*scale, size-8*scale, size-8*scale], radius=40*scale, fill=(50, 50, 50))

colors = [
  (0, 180, 0),
  (220, 0, 0),
  (220, 200, 0),
  (0, 120, 220),
  (160, 0, 220),
]

margin_x = 40 * scale
line_h = 20 * scale
gap = 12 * scale
total_h = len(colors) * line_h + (len(colors) - 1) * gap
start_y = (size - total_h) // 2

for i, color in enumerate(colors):
  y = start_y + i * (line_h + gap)
  alpha = 180
  fill = (*color, alpha)
  draw.rounded_rectangle(
    [margin_x, y, size - margin_x, y + line_h],
    radius=4*scale,
    fill=fill,
  )

img = img.resize((256, 256), Image.LANCZOS)
img.save('images/icon.png')
