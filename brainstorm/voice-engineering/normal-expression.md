This guide is designed for the Kokoro-FastAPI wrapper (or compatible Docker images) running at http://localhost:8880.
Because Kokoro is an open-weight model, it does not use a simple "emotion" slider (like emotion="happy"). Instead, you must "direct" the AI using Voice Mixing, Punctuation, and Speed parameters in your API payload.
## 1. The API Endpoint
Your requests should be sent to the OpenAI-compatible endpoint.

* URL: http://localhost:8880/v1/audio/speech
* Method: POST
* Headers: Content-Type: application/json

------------------------------
## 2. Guide to Emotional Expressions## A. Anger / Urgency
To simulate anger, you need to increase the speaking rate and use "choppy" punctuation to create aggressive, staccato rhythm.

* Voice Strategy: Mix a deeper voice to add "weight."
* Speed: 1.1 to 1.2 (Faster = more aggressive).
* Text Strategy: Use short sentences. Use exclamation points to raise the pitch at the end of words.
* Payload:

{
  "model": "kokoro",
  "input": "Listen to me! I said—stop it right now! We are out of time!",
  "voice": "am_adam", 
  "speed": 1.2
}

## B. Sadness / Hesitation
Sadness requires a slower pace and "breath" in the voice. The Kokoro model interprets ellipses (...) as distinct pauses or trailing thoughts.

* Voice Strategy: Use af_heart (naturally breathy) or bf_emma.
* Speed: 0.85 to 0.9 (Slower = more somber).
* Text Strategy: Use ellipses ... between phrases to force the AI to pause and "sigh." Lowercase letters can sometimes result in softer delivery.
* Payload:

{
  "model": "kokoro",
  "input": "I just... I don't know if I can do this anymore... it's too hard.",
  "voice": "af_heart",
  "speed": 0.85
}

## C. Excitement / Joy
Joy is characterized by pitch variation and speed. Punctuation is critical here to prevent a monotone delivery.

* Voice Strategy: af_bella or af_sarah (Higher pitch, clearer).
* Speed: 1.1.
* Text Strategy: Use exclamation marks ! generously. Combine voices to create a "lighter" tone (e.g., blending two female voices).
* Payload:

{
  "model": "kokoro",
  "input": "Oh my god! You won't believe what happened! We actually won!",
  "voice": "af_bella+af_sarah",
  "speed": 1.1
}

## D. Professional / News Anchor
For a neutral, authoritative tone, you want to remove "breathy" artifacts and stabilize the rhythm.

* Voice Strategy: am_michael or af_nicole.
* Speed: 1.0 (Default).
* Text Strategy: Use standard grammar. Avoid ellipses. Use commas , for logical breaks.
* Payload:

{
  "model": "kokoro",
  "input": "The stock market closed at a record high today, driven by tech sector gains.",
  "voice": "am_michael",
  "speed": 1.0
}

------------------------------
## 3. Advanced: Voice Mixing (The "Tone" Hack)
The localhost:8880 endpoint (via Kokoro-FastAPI) supports Voice Mixing directly in the voice string. This allows you to create unique emotional textures that single voices cannot achieve.

* The Syntax: Use a + symbol between voice names.
* The Logic: The first voice provides the dominant pronunciation; the second adds "flavor."

| Target Emotion | Recommended Mix | Why? |
|---|---|---|
| Warm/Motherly | af_heart+af_bella | Combines heart's breathiness with bella's clarity. |
| Ominous/Villain | am_adam+am_michael | Adds depth and grit to the voice. |
| Anxious/Fast | af_sky+af_nicole | Creates a slightly unstable, high-energy pitch. |

Example Mixed Payload:

{
  "model": "kokoro",
  "input": "I am not sure who to trust in this city...",
  "voice": "am_adam+am_michael",
  "speed": 0.9
}