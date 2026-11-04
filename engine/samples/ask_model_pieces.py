"""Sample recipe runner: ask a model a list of questions, one saved piece per question.

Bring your own AI. This talks to any OpenAI-compatible chat endpoint, which includes a local
Ollama (the default below) and any hosted service you hold a key for. Nothing is bundled and
nothing is sent anywhere unless you point it there.

  RACK_LLM_URL    base URL, default http://127.0.0.1:11434/v1   (local Ollama)
  RACK_LLM_MODEL  model name, default llama3.2
  RACK_LLM_KEY    optional API key, sent as a Bearer token (never written to the saved pieces)

Each answer is saved before the next question is asked, so a pause or a crash resumes at the
first question that has no saved answer.
"""
import json
import os
import urllib.request

from rack_jobs import from_environment

QUESTIONS = [
    'In one sentence, what is a durable job queue?',
    'In one sentence, why should a job runner refuse work that does not fit in memory?',
    'In one sentence, what does it mean for a job to resume at the first unsaved piece?',
]


def ask(question):
    base = os.environ.get('RACK_LLM_URL', 'http://127.0.0.1:11434/v1').rstrip('/')
    model = os.environ.get('RACK_LLM_MODEL', 'llama3.2')
    headers = {'Content-Type': 'application/json'}
    key = os.environ.get('RACK_LLM_KEY', '')
    if key:
        headers['Authorization'] = 'Bearer ' + key
    body = json.dumps({'model': model, 'messages': [{'role': 'user', 'content': question}]}).encode()
    request = urllib.request.Request(base + '/chat/completions', data=body, headers=headers)
    with urllib.request.urlopen(request, timeout=120) as response:
        data = json.load(response)
    return {'question': question, 'answer': data['choices'][0]['message']['content']}


def main():
    p = from_environment()
    names = ['q%d' % (i + 1) for i in range(len(QUESTIONS))]
    p.plan(names)
    for name, question in zip(names, QUESTIONS):
        p.run(name, lambda q=question: ask(q))


if __name__ == '__main__':
    main()
