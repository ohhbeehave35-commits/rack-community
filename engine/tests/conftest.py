import os
from pathlib import Path
import shutil
import sys

import pytest

ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE))


@pytest.fixture
def rack(tmp_path, monkeypatch):
    """A fresh Rack folder with the sample recipes, samples and peaks, and room to spare in the memory budget."""
    root = tmp_path / 'rack'
    root.mkdir()
    shutil.copytree(ENGINE / 'recipes', root / 'recipes')
    shutil.copytree(ENGINE / 'samples', root / 'samples')
    shutil.copy(ENGINE / 'peaks.conf', root / 'peaks.conf')
    monkeypatch.setenv('RACK_DIR', str(root))
    monkeypatch.setenv('ADMIT_USED_GB', '5')
    monkeypatch.setenv('RACK_TOKEN', 'test-token-not-a-real-value')
    return root
