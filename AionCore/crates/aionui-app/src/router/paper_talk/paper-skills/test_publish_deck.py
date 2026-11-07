import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from publish_deck import NS, publish


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.figure = self.root / 'paper.png'
        self.figure.write_bytes(b'original paper figure')
        self.request = self.root / 'request.json'
        self.request.write_text(json.dumps({'outline': [{'notes': 'Confirmed explanation', 'figure': str(self.figure)}]}))

    def deck(self, name, text='Editable title', notes='Confirmed explanation', image=b'original paper figure'):
        path = self.root / name
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('ppt/slides/slide1.xml', f'<p:sld xmlns:p="{NS["p"]}" xmlns:a="{NS["a"]}" xmlns:r="{NS["r"]}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>')
            archive.writestr('ppt/slides/_rels/slide1.xml.rels', '<Relationships><Relationship Id="rId1" Target="../media/image1.png"/></Relationships>')
            archive.writestr('ppt/media/image1.png', image)
            archive.writestr('ppt/notesSlides/notesSlide1.xml', f'<p:notes xmlns:p="{NS["p"]}" xmlns:a="{NS["a"]}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>{notes}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>')
        return path

    def test_preserves_original_data_and_adds_manual_transition(self):
        output = self.root / 'published.pptx'
        publish(self.request, self.deck('design.pptx', text=''), self.deck('editable.pptx'), output)
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(archive.read('ppt/media/image1.png'), self.figure.read_bytes())
            self.assertIn(b'advClick="1"', archive.read('ppt/slides/slide1.xml'))
            self.assertNotIn(b'advTm', archive.read('ppt/slides/slide1.xml'))

    def test_adds_original_source_references_to_notes(self):
        data = json.loads(self.request.read_text())
        data['outline'][0]['evidence'] = [{'paper': 'p1', 'page': 7, 'label': 'Table 3'}]
        data['papers'] = [{'id': 'p1', 'title': 'Original paper', 'source': 'https://example.org/paper'}]
        self.request.write_text(json.dumps(data))
        output = self.root / 'out.pptx'
        publish(self.request, self.deck('design.pptx'), self.deck('editable.pptx'), output)
        with zipfile.ZipFile(output) as archive:
            notes = archive.read('ppt/notesSlides/notesSlide1.xml').decode()
            self.assertIn('Confirmed explanation', notes)
            self.assertIn('Original paper', notes)
            self.assertIn('Table 3', notes)
            self.assertIn('https://example.org/paper', notes)

    def test_rejects_changed_confirmed_table_value(self):
        data = json.loads(self.request.read_text())
        data['outline'][0]['table'] = [['Result'], ['21.52']]
        self.request.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, 'confirmed table cell: 21.52'):
            publish(self.request, self.deck('design.pptx'), self.deck('editable.pptx', text='Result 21.53'), self.root / 'out.pptx')

    def test_rejects_image_only_conversion(self):
        with self.assertRaisesRegex(ValueError, 'no editable text'):
            publish(self.request, self.deck('design.pptx'), self.deck('editable.pptx', text=''), self.root / 'out.pptx')

    def test_rejects_lost_notes(self):
        with self.assertRaisesRegex(ValueError, 'lost confirmed speaker notes'):
            publish(self.request, self.deck('design.pptx'), self.deck('editable.pptx', notes='Changed'), self.root / 'out.pptx')

    def test_rejects_regenerated_paper_figure(self):
        with self.assertRaisesRegex(ValueError, 'original paper figure bytes'):
            publish(self.request, self.deck('design.pptx'), self.deck('editable.pptx', image=b'regenerated'), self.root / 'out.pptx')


if __name__ == '__main__':
    unittest.main()
