exports.handler = async function(event, context) {
    // 1. Intestazioni di Sicurezza CORS (Fondamentali per evitare blocchi del browser)
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
  
    // 2. Gestione pre-flight del browser
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }
  
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
    }
  
    try {
      const body = JSON.parse(event.body);
      const text = body.text;
  
      if (!text) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Testo mancante" }) };
      }
  
      const apiKey = process.env.GEMINI_API_KEY;
  
      if (!apiKey) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Server API Key non configurata in Netlify" }) };
      }
  
      // Controllo vitale: Verifica che Netlify stia usando una versione moderna di Node.js
      if (typeof fetch === 'undefined') {
          return { statusCode: 500, headers, body: JSON.stringify({ error: "Errore Netlify: Comando 'fetch' non supportato. Imposta NODE_VERSION a 20." }) };
      }
  
      const instruction = `Say in Italian: ${text}.`;
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
  
      // Chiamata a Google
      const geminiResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: instruction }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } }
          }
        })
      });
  
      // Se Google rifiuta la chiave o la chiamata
      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        console.error("Google API Error:", errorText);
        return { statusCode: geminiResponse.status, headers, body: JSON.stringify({ error: `Rifiutato da Google: ${errorText}` }) };
      }
  
      const data = await geminiResponse.json();
  
      // Controllo anti-crash se Google blocca alcune parole per "sicurezza"
      if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content) {
          console.error("Struttura inattesa da Google:", data);
          return { statusCode: 500, headers, body: JSON.stringify({ error: "Google ha restituito una risposta vuota o bloccata." }) };
      }
  
      const audioBase64 = data.candidates[0].content.parts[0].inlineData.data;
  
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ audioData: audioBase64 })
      };
  
    } catch (error) {
      console.error("Eccezione Fatale Server:", error);
      // ORA SAPREMO ESATTAMENTE COSA NON VA!
      return { statusCode: 500, headers, body: JSON.stringify({ error: `Dettaglio Errore: ${error.message}` }) };
    }
  };