"""Intercept the actual HTTP request the Python SDK sends to aihubmix."""

import json
import os
import tempfile

# Intercept httpx (which google-genai uses internally)
import httpx

_original_send = httpx.Client.send


def _capture_send(self, request, **kwargs):
    if "generateContent" in str(request.url):
        print(f"\n=== CAPTURED generateContent REQUEST ===")
        print(f"URL: {request.url}")
        print(f"Method: {request.method}")
        print(f"Headers: {dict(request.headers)}")
        body = request.content
        if body:
            try:
                parsed = json.loads(body)
                print(f"\nBody ({len(body)} bytes):")
                print(json.dumps(parsed, indent=2, default=str)[:5000])
            except:
                print(f"\nRaw body ({len(body)} bytes): {body[:2000]}")
    return _original_send(self, request, **kwargs)


httpx.Client.send = _capture_send

from google import genai

API_KEY = os.environ.get("AIHUBMIX_KEY", "")
BASE_URL = "https://aihubmix.com/gemini"

client = genai.Client(
    api_key=API_KEY,
    http_options={"base_url": BASE_URL},
)

with tempfile.NamedTemporaryFile(suffix=".txt", mode="w", delete=False) as f:
    f.write("Hello, this is a test file.")
    test_file_path = f.name

print("=== UPLOADING FILE ===")
myfile = client.files.upload(file=test_file_path)
print(f"name: {myfile.name}")
print(f"uri: {myfile.uri}")

print("\n=== CALLING generateContent ===")
try:
    response = client.models.generate_content(
        model="gemini-3.1-flash-lite-preview",
        contents=["What is in this file?", myfile],
    )
    print(f"\nResponse: {response.text[:200] if response.text else 'None'}")
except Exception as e:
    print(f"\nError: {e}")

os.unlink(test_file_path)
try:
    client.files.delete(name=myfile.name)
except:
    pass
print("\nDone.")
