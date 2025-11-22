import os
import json
from google import genai
from google.genai import types
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# Configure Gemini API
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    print("WARNING: GEMINI_API_KEY not found in environment variables.")

# Initialize client
client = genai.Client(api_key=GEMINI_API_KEY)

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

@app.route('/api/generate_question', methods=['POST'])
def generate_question():
    try:
        data = request.json
        category = data.get('category', 'General Knowledge')
        difficulty = data.get('difficulty', 'Medium')
        count = data.get('count', 1) # Default to 1 if not specified, but we aim for 10
        
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
        
        response = client.models.generate_content(
            model='gemini-2.5-flash',
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
            
        return jsonify(json.loads(text))

    except Exception as e:
        print(f"Error generating question: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
