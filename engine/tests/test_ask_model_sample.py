"""The 'bring your own AI' sample talks to an OpenAI-compatible endpoint; checked against a throwaway local server."""
import importlib.util
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

SAMPLE = Path(__file__).resolve().parents[1] / 'samples' / 'ask_model_pieces.py'
SEEN = []


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        SEEN.append({'path': self.path, 'auth': self.headers.get('Authorization'), 'body': json.loads(self.rfile.read(length))})
        reply = json.dumps({'choices': [{'message': {'content': 'a queue that survives restarts'}}]}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(reply)))
        self.end_headers()
        self.wfile.write(reply)

    def log_message(self, *args):
        pass


def load_sample():
    spec = importlib.util.spec_from_file_location('ask_model_pieces', SAMPLE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_ask_sends_the_key_as_a_bearer_token_and_does_not_save_it(monkeypatch):
    server = HTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        monkeypatch.setenv('RACK_LLM_URL', 'http://127.0.0.1:%d/v1' % server.server_port)
        monkeypatch.setenv('RACK_LLM_MODEL', 'test-model')
        monkeypatch.setenv('RACK_LLM_KEY', 'sk-test-not-a-real-key')
        result = load_sample().ask('What is a queue?')
    finally:
        server.shutdown()
    assert SEEN[-1]['path'] == '/v1/chat/completions'
    assert SEEN[-1]['auth'] == 'Bearer sk-test-not-a-real-key'
    assert SEEN[-1]['body']['model'] == 'test-model'
    assert result == {'question': 'What is a queue?', 'answer': 'a queue that survives restarts'}
    assert 'sk-test' not in json.dumps(result)


def test_no_key_means_no_authorization_header(monkeypatch):
    server = HTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        monkeypatch.setenv('RACK_LLM_URL', 'http://127.0.0.1:%d/v1' % server.server_port)
        monkeypatch.delenv('RACK_LLM_KEY', raising=False)
        load_sample().ask('hello')
    finally:
        server.shutdown()
    assert SEEN[-1]['auth'] is None


def test_the_sample_recipe_file_is_valid_and_not_loaded_until_copied():
    root = Path(__file__).resolve().parents[1]
    recipe = json.loads((root / 'samples' / 'ask_model.recipe.json').read_text())
    assert recipe['action'] == 'ask_model' and recipe['script'] == 'samples/ask_model_pieces.py'
    assert not (root / 'recipes' / 'ask_model.json').exists(), 'it is an opt-in example, not one of the three starter recipes'
