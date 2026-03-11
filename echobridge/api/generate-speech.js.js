export default async (req, context) => {
  // 1. Intestazioni CORS
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  // 2. Gestione pre-flight
  if (req.method === "OPTIONS") {
    return new Response("", { status: 200, headers });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const text = body.text;

    if (!text) {
      return new Response(JSON.stringify({ error: "Testo mancante" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // 3. Recupero Chiave API (Deve essere in Netlify!)
    const apiKey = Netlify.env.get("GEMINI_API_KEY") || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Server API Key non configurata in Netlify" }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    const instruction = `Say in Italian: ${text}.`;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

    const geminiResponse = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: instruction }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
        },
      }),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      return new Response(
        JSON.stringify({ error: `Rifiutato da Google: ${errorText}` }),
        { status: geminiResponse.status, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    const data = await geminiResponse.json();

    if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content) {
      return new Response(
        JSON.stringify({ error: "Google ha restituito una risposta vuota." }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    const audioBase64 = data.candidates[0].content.parts[0].inlineData.data;

    return new Response(JSON.stringify({ audioData: audioBase64 }), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: `Dettaglio Errore: ${error.message}` }),
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }
};