import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import zipfile
from xml.etree import ElementTree as ET

NS = {'p': 'http://schemas.openxmlformats.org/presentationml/2006/main', 'a': 'http://schemas.openxmlformats.org/drawingml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def slides(archive):
    return sorted((name for name in archive.namelist() if name.startswith('ppt/slides/slide') and name.endswith('.xml') and '/_rels/' not in name), key=lambda name: int(Path(name).stem[5:]))


def publish(request, design, editable, output):
    report = json.loads(Path(request).read_text())
    outline = report['outline']
    papers = {paper['id']: paper for paper in report.get('papers', [])}
    with zipfile.ZipFile(design) as images, zipfile.ZipFile(editable) as deck:
        require(len(slides(images)) == len(outline), 'Design deck page count differs from confirmed outline')
        names = slides(deck)
        require(len(names) == len(outline), 'Editable deck page count differs from confirmed outline')
        require(sum(info.file_size for info in deck.infolist()) <= 500_000_000, 'PPT exceeds the expanded size limit')
        require(deck.testzip() is None, 'PPT archive is corrupt')
        content = {name: deck.read(name) for name in deck.namelist()}
        for index, (name, expected) in enumerate(zip(names, outline), 1):
            root = ET.fromstring(content[name])
            text = ''.join(node.text or '' for node in root.findall('.//a:t', NS))
            require(bool(text.strip()), f'Page {index} contains no editable text')
            visible = ''.join(text.split())
            for row in expected.get('table', []):
                for cell in row:
                    require(''.join(cell.split()) in visible, f'Page {index} lost or changed confirmed table cell: {cell}')
            notes_path = f'ppt/notesSlides/notesSlide{index}.xml'
            require(notes_path in content, f'Page {index} is missing speaker notes')
            notes = ''.join(ET.fromstring(content[notes_path]).itertext())
            require(''.join(expected['notes'].split()) in ''.join(notes.split()), f'Page {index} lost confirmed speaker notes')
            if expected.get('evidence'):
                notes_root = ET.fromstring(content[notes_path])
                body = None
                for shape in notes_root.findall('.//p:sp', NS):
                    placeholder = shape.find('.//p:ph', NS)
                    if placeholder is not None and placeholder.get('type') == 'body':
                        body = shape.find('p:txBody', NS)
                        break
                require(body is not None, f'Page {index} has no notes body for citations')
                for evidence in expected['evidence']:
                    paper = papers.get(evidence['paper'])
                    require(paper is not None, f'Page {index} references an unknown paper')
                    citation = f"来源：{paper['title']} · PDF 第 {evidence['page']} 页 · {evidence['label']} · {paper.get('source', '')}"
                    paragraph = ET.SubElement(body, '{' + NS['a'] + '}p')
                    run = ET.SubElement(paragraph, '{' + NS['a'] + '}r')
                    ET.SubElement(run, '{' + NS['a'] + '}t').text = citation
                content[notes_path] = ET.tostring(notes_root, encoding='utf-8', xml_declaration=True)
            figure = expected.get('figure')
            if figure:
                digest = hashlib.sha256(Path(figure).read_bytes()).digest()
                relpath = f'ppt/slides/_rels/slide{index}.xml.rels'
                require(relpath in content, f'Page {index} has no figure relationships')
                rels = ET.fromstring(content[relpath])
                targets = {rel.get('Id'): os.path.normpath('ppt/slides/' + rel.get('Target', '')) for rel in rels if rel.get('TargetMode') != 'External'}
                embedded = [targets.get(blip.get('{' + NS['r'] + '}embed')) for blip in root.findall('.//a:blip', NS)]
                require(any(target in content and hashlib.sha256(content[target]).digest() == digest for target in embedded), f'Page {index} does not preserve the original paper figure bytes')
            for old in root.findall('p:transition', NS):
                root.remove(old)
            transition = ET.Element('{' + NS['p'] + '}transition', {'spd': 'med', 'advClick': '1'})
            ET.SubElement(transition, '{' + NS['p'] + '}fade')
            before = next((i for i, child in enumerate(root) if child.tag in {'{' + NS['p'] + '}timing', '{' + NS['p'] + '}extLst'}), len(root))
            root.insert(before, transition)
            content[name] = ET.tostring(root, encoding='utf-8', xml_declaration=True)
        output = Path(output)
        with tempfile.NamedTemporaryFile(dir=output.parent, suffix='.pptx', delete=False) as stream:
            temporary = Path(stream.name)
        try:
            with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as archive:
                for name, data in content.items():
                    archive.writestr(name, data)
            os.replace(temporary, output)
        finally:
            temporary.unlink(missing_ok=True)
    print(json.dumps({'slides': len(outline), 'editable_text': True, 'notes_preserved': True, 'original_figures_preserved': True, 'transition': 'fade'}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for option in ('request', 'design', 'editable', 'output'):
        parser.add_argument('--' + option, required=True)
    args = parser.parse_args()
    publish(args.request, args.design, args.editable, args.output)
