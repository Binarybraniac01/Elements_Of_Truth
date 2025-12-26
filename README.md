# Elements of Truth 🌌

**Elements of Truth** is an AI-powered multiplayer trivia board game where knowledge meets strategy. Unlike standard trivia, players don't just answer questions—they must wager **Confidence Tokens** based on how certain they are of their truth.

Powered by **Google Gemini**, the game generates unique, reasoning-based questions on the fly, ensuring no two games are ever the same.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.9+-blue.svg)
![Flask](https://img.shields.io/badge/flask-3.0+-green.svg)

## 🎮 Game Features

* **1-6 Player Multiplayer:** Play solo or compete with up to 6 friends locally.
* **AI-Generated Questions:** Uses Google's Gemini API to generate creative questions across varying difficulties and categories (Science, History, Philosophy, Pop Culture, etc.).
* **4 Unique Question Modes:**
    * **MCQ:** Standard multiple-choice reasoning.
    * **True/False:** Surprising facts that challenge intuition.
    * **More/Less:** Comparative questions about scale and magnitude.
    * **Number Line:** Proportional estimates (e.g., "If Earth were a basketball...").
* **Strategic Betting:** Players hold a set of "Confidence Tokens" (valued 1–10). You must decide when to play your high-value tokens to maximize your score.
* **Immersive UI:** A futuristic "glassmorphism" aesthetic with 3D card effects and dynamic sound design.
* **Offline Capability:** Questions are fetched in batches and stored locally in **IndexedDB**, ensuring smooth gameplay without constant loading.

## 🛠️ Tech Stack

* **Backend:** Python, Flask
* **AI Model:** Google Gemini 2.5 Flash (via `google-genai` SDK)
* **Frontend:** HTML5, CSS3 (Glassmorphism), Vanilla JavaScript
* **Storage:** IndexedDB (Client-side caching)
* **Deployment:** Configured for Vercel (Serverless)

## 🚀 Getting Started

### Prerequisites
* Python 3.9 or higher
* A Google Gemini API Key (Get one at [Google AI Studio](https://aistudio.google.com/))

### Installation

1.  **Clone the repository**
    ```bash
    git clone [https://github.com/yourusername/elements-of-truth.git](https://github.com/yourusername/elements-of-truth.git)
    cd elements-of-truth
    ```

2.  **Create a virtual environment**
    ```bash
    python -m venv venv
    source venv/bin/activate  # On Windows use `venv\Scripts\activate`
    ```

3.  **Install dependencies**
    ```bash
    pip install -r requirements.txt
    ```

4.  **Configure Environment Variables**
    Create a `.env` file in the root directory and add your API key:
    ```env
    GEMINI_API_KEY=your_actual_api_key_here
    ```

5.  **Run the Application**
    ```bash
    python app.py
    ```
    The game will be available at `http://localhost:5000`.

## 🎲 How to Play

1.  **Setup:** Choose the number of players, enter names, and select a category/difficulty.
2.  **The Question:** A question appears on the screen.
3.  **The Wager:** The current player selects their answer **AND** a Confidence Token (1-10).
    * *Tokens are single-use!* Once you use your "10" token, you can't use it again for the rest of the game.
4.  **Scoring:**
    * **Correct:** You gain points equal to the token value.
    * **Incorrect:** You score 0 points, and the token is lost.
5.  **Winning:** The player with the highest score after 10 rounds wins the game.

## 📦 Deployment

This project is ready for deployment on **Vercel**.

1.  Install the Vercel CLI: `npm i -g vercel`
2.  Run `vercel` in the project root.
3.  **Important:** Add your `GEMINI_API_KEY` in the Vercel project settings (Environment Variables).

## 📄 License

[MIT License](LICENSE)
