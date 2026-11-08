import base64
import io
from pathlib import Path
from PIL import Image

assets = Path('assets')
for name in ['c01', 'pdp-conflict', 'agent-sections', 'starting-ui', 'figma-keyframe', 'film-consent', 'film-entry', 'figma-section']:
    paths = [assets / (name + '.' + suffix) for suffix in ('png', 'jpg')]
    with Image.open(next(path for path in paths if path.exists())) as src:
        src.thumbnail((1100, 740))
        img = src.convert('RGB')
    stream = io.BytesIO()
    img.save(stream, 'JPEG', optimize=True, quality=78)
    payload = base64.b64encode(stream.getvalue()).decode('ascii')
    width, height = img.size
    (assets / (name + '.svg')).write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}">'
        f'<image width="{width}" height="{height}" href="data:image/jpeg;base64,{payload}"/></svg>\n',
        encoding='utf-8',
    )

