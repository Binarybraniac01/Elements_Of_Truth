import os
import json
import time
import random
from google import genai
from google.genai import types
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
from threading import Lock
from datetime import datetime

# Note: Server-side question caching removed - now handled client-side via IndexedDB

load_dotenv()

app = Flask(__name__)

# Configure Gemini API
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    print("WARNING: GEMINI_API_KEY not found in environment variables.")

# Initialize client
client = genai.Client(api_key=GEMINI_API_KEY)

# ============= RATE LIMITING =============
class RateLimiter:
    """Rate limiter with sliding window to respect API limits."""
    
    def __init__(self, max_calls_per_minute=4, max_calls_per_day=18):
        self.max_rpm = max_calls_per_minute  # Under the 5 RPM limit
        self.max_rpd = max_calls_per_day     # Under the 20 RPD limit
        self.minute_calls = []
        self.day_calls = []
        self.lock = Lock()
    
    def can_make_request(self):
        """Check if we can make a request without hitting limits."""
        with self.lock:
            now = time.time()
            today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
            
            # Clean old entries
            self.minute_calls = [t for t in self.minute_calls if now - t < 60]
            self.day_calls = [t for t in self.day_calls if t > today_start]
            
            return len(self.minute_calls) < self.max_rpm and len(self.day_calls) < self.max_rpd
    
    def record_request(self):
        """Record that a request was made."""
        with self.lock:
            now = time.time()
            self.minute_calls.append(now)
            self.day_calls.append(now)
    
    def get_wait_time(self):
        """Get seconds to wait before next request is allowed."""
        with self.lock:
            if len(self.minute_calls) >= self.max_rpm:
                oldest = min(self.minute_calls)
                return max(0, 60 - (time.time() - oldest))
            return 0
    
    def get_daily_remaining(self):
        """Get remaining daily requests."""
        with self.lock:
            today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
            self.day_calls = [t for t in self.day_calls if t > today_start]
            return self.max_rpd - len(self.day_calls)

rate_limiter = RateLimiter(max_calls_per_minute=8, max_calls_per_day=18)  # Adjusted for 10 RPM / 20 RPD API limits

# ============= FALLBACK QUESTIONS =============
FALLBACK_FILE = os.path.join(os.path.dirname(__file__), 'fallback_questions.json')

def load_fallback_questions():
    """Load fallback questions from JSON file."""
    try:
        with open(FALLBACK_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def get_fallback_questions(category, difficulty, count=10, exclude_ids=None):
    """Get questions from fallback file."""
    fallbacks = load_fallback_questions()
    key = f"{category}_{difficulty}"
    
    if key not in fallbacks:
        # Try to find any available key
        available_keys = list(fallbacks.keys())
        if available_keys:
            key = random.choice(available_keys)
        else:
            return None
    
    questions = fallbacks[key][:]
    
    # Filter excluded
    if exclude_ids:
        exclude_set = set(exclude_ids)
        questions = [q for q in questions if q.get('_id') not in exclude_set]
    
    random.shuffle(questions)
    return questions[:count]

# ============= ROUTES =============
@app.route('/')
def landing():
    return render_template('landing.html')

@app.route('/setup')
def setup():
    return render_template('setup.html')

@app.route('/loading')
def loading():
    return render_template('loading.html')

@app.route('/game')
def game():
    return render_template('game.html')

@app.route('/results')
def results():
    return render_template('results.html')

# ============= API ENDPOINTS =============
@app.route('/api/generate_question', methods=['POST'])
def generate_question():
    """
    Generate questions using Gemini API.
    Note: Caching is now handled client-side via IndexedDB.
    Server just handles: rate limiting -> API call -> fallback
    """
    try:
        data = request.json
        category = data.get('category', 'General Knowledge')
        difficulty = data.get('difficulty', 'Medium')
        count = data.get('count', 10)
        exclude_ids = data.get('exclude_ids', [])
        
        # STEP 1: Check if we can make an API call
        if not rate_limiter.can_make_request():
            print(f"[RATE LIMITED] Daily remaining: {rate_limiter.get_daily_remaining()}")
            
            # Use fallback questions
            fallback = get_fallback_questions(category, difficulty, count, exclude_ids)
            if fallback:
                print(f"[FALLBACK] Returning {len(fallback)} fallback questions")
                return jsonify(fallback)
            
            return jsonify({"error": "Rate limit exceeded and no fallback available"}), 429
        
        # STEP 2: Make API call with retry logic
        questions = call_gemini_with_retry(category, difficulty, count)
        
        if questions:
            print(f"[API SUCCESS] Generated {len(questions)} questions")
            return jsonify(questions)
        else:
            # API failed, use fallback
            fallback = get_fallback_questions(category, difficulty, count, exclude_ids)
            if fallback:
                print(f"[FALLBACK] API failed, returning {len(fallback)} fallback questions")
                return jsonify(fallback)
            return jsonify({"error": "Failed to generate questions"}), 500
            
    except Exception as e:
        print(f"Error generating question: {e}")
        
        # Try fallback on any error
        fallback = get_fallback_questions(
            data.get('category', 'General Knowledge'),
            data.get('difficulty', 'Medium'),
            10
        )
        if fallback:
            return jsonify(fallback)
        
        return jsonify({"error": str(e)}), 500


def call_gemini_with_retry(category, difficulty, count, max_retries=3):
    """Call Gemini API with exponential backoff retry logic."""
    
    prompt = f"""
    Generate {count} creative, concise, and thought-provoking questions for "Elements of Truth" board game.
    
    Category: {category}
    Difficulty: {difficulty}
    
    IMPORTANT: Generate questions across 4 TYPES. Ensure AT LEAST 1 of each type, distribute remaining randomly.
    
    **Question Types:**
    
    1. **MCQ (Multiple Choice)** - Short, creative questions with 4 options
       - Focus on reasoning and obscure but deducible facts
       - Keep questions concise (1-2 sentences max)
    
    2. **True/False** - Surprising facts that challenge intuition
       - Examples: "Sharks have existed longer than Saturn's rings", "Cleopatra lived closer to iPhone release than Great Pyramid construction"
       - Provide 2 options: True, False
    
    3. **More/Less** - Comparative questions about scale/magnitude
       - Examples: "Earth's atmosphere weight vs all living things combined", "Trees on Earth vs stars in Milky Way"
       - Provide 2 options: More, Less
    
    4. **Number Line** - Scale/proportion questions with multiple choice answers
       - Examples: "If Earth = basketball, atmosphere thickness in mm?", "If Sun = front door, Earth size?"
       - Provide 4 numerical options (A, B, C, D)
    
    **Output JSON format:**
    [
        {{
            "type": "mcq",
            "question": "Short question text",
            "options": {{"A": "text", "B": "text", "C": "text", "D": "text"}},
            "correct": "A",
            "explanation": "Brief explanation"
        }},
        {{
            "type": "truefalse",
            "question": "Surprising fact statement",
            "options": {{"A": "True", "B": "False"}},
            "correct": "A",
            "explanation": "Brief explanation"
        }},
        {{
            "type": "moreless",
            "question": "Comparative question",
            "options": {{"A": "More", "B": "Less"}},
            "correct": "A",
            "explanation": "Brief explanation"
        }},
        {{
            "type": "numberline",
            "question": "Scale/proportion question",
            "options": {{"A": "1mm", "B": "10mm", "C": "100mm", "D": "1000mm"}},
            "correct": "B",
            "explanation": "Brief explanation"
        }}
    ]
    
    Remember: AT LEAST 1 of each type must be present in the {count} questions.
    """
    
    for attempt in range(max_retries):
        try:
            rate_limiter.record_request()
            
            response = client.models.generate_content(
                model='gemini-2.5-flash-lite',  # Using Flash Lite for better rate limits (10 RPM vs 5 RPM)
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.9,
                    top_p=1,
                    top_k=40,
                    max_output_tokens=8192,
                    safety_settings=[
                        types.SafetySetting(
                            category='HARM_CATEGORY_HARASSMENT',
                            threshold='BLOCK_NONE'
                        ),
                        types.SafetySetting(
                            category='HARM_CATEGORY_HATE_SPEECH',
                            threshold='BLOCK_NONE'
                        ),
                        types.SafetySetting(
                            category='HARM_CATEGORY_SEXUALLY_EXPLICIT',
                            threshold='BLOCK_NONE'
                        ),
                        types.SafetySetting(
                            category='HARM_CATEGORY_DANGEROUS_CONTENT',
                            threshold='BLOCK_NONE'
                        ),
                    ]
                )
            )
            
            # Extract text from response
            text = response.text
            
            # Clean up response text if it contains markdown code blocks
            if text.startswith("```json"):
                text = text[7:]
            if text.endswith("```"):
                text = text[:-3]
            
            text = text.strip()
            return json.loads(text)
            
        except Exception as e:
            error_str = str(e)
            print(f"[ATTEMPT {attempt + 1}/{max_retries}] API Error: {error_str}")
            
            if '429' in error_str or 'RESOURCE_EXHAUSTED' in error_str:
                # Rate limited - exponential backoff
                wait_time = (2 ** attempt) * 5  # 5s, 10s, 20s
                print(f"Rate limited. Waiting {wait_time}s before retry...")
                time.sleep(wait_time)
            else:
                # Other error - shorter wait
                time.sleep(2)
    
    return None


@app.route('/api/status', methods=['GET'])
def api_status():
    """Get API rate limit status (for debugging)."""
    return jsonify({
        'daily_requests_remaining': rate_limiter.get_daily_remaining(),
        'can_make_request': rate_limiter.can_make_request()
    })


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
