import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Play, X, Volume2, Settings, Award, Flame, Star, FileText, Check, AlertCircle, Lock, Brain, Smartphone, Loader2, DownloadCloud, Database } from 'lucide-react';

// ============================================================================
// MODULO 5: DATA LAYER (Pronto per essere un JSON esterno)
// ============================================================================
const clinicalProtocolJSON = [
    { day: 1, phase: "Facilitazione", title: "Vocali e Labiali", objective: "Fonemi fondamentali", words: { mono: ["Re", "Tè", "Blu", "Tu", "Tre", "Re", "Se", "Me", "Si", "Vi", "No", "Bo", "Ma", "Ba", "Va", "Fa", "Da", "Ta"], bi: ["Mamma", "Nanna", "Papà", "Pappa", "Bebè", "Pepe", "Pipi", "Bibì", "Popò", "Bobò", "Tata", "Dada", "Mimì", "Ninì", "Coco", "Gogo", "Lulù", "Tutù"], tri: ["Banana", "Canana", "Patata", "Batata", "Bibita", "Pipita", "Patatine", "Patatina", "Cucinina", "Cucina", "Ninnanna", "Nonnanna", "Ninfee", "Linfee", "Marmellata", "Martellata", "Amaca", "Lumaca"] } },
    { day: 2, phase: "Facilitazione", title: "Consonanti Occlusive", objective: "Occlusive in contesti vocalici", words: { mono: ["Ho", "O", "Ha", "A", "E", "Eh", "Ma", "Ba", "Se", "Ze", "Né", "Me", "Ciò", "Giò", "Già", "Là", "Più", "Giù"], bi: ["Palla", "Balla", "Bollo", "Pollo", "Sella", "Cella", "Gomma", "Somma", "Penna", "Panna", "Tetta", "Detta", "Nonno", "Tonno", "Messa", "Nessa", "Cassa", "Tassa"], tri: ["Carotina", "Cartina", "Limonino", "Limonata", "Panino", "Puntino", "Tavolino", "Topolino", "Regalo", "Righello", "Sirena", "Serena", "Medusa", "Pelusa", "Moneta", "Cometa", "Sedano", "Metano", "Tucano", "Vulcano"] } },
    { day: 3, phase: "Facilitazione", title: "Fricative e Liquide", objective: "Suoni continui e liquidi", words: { mono: ["Chi", "Qui", "Che", "Te", "Di", "Li", "In", "Un", "Con", "Non", "Su", "Tu", "Per", "Ver", "Tra", "Fra", "Nel", "Del"], bi: ["Casa", "Cassa", "Cosa", "Osa", "Rosa", "Sposa", "Riso", "Viso", "Mare", "Pare", "Mela", "Vela", "Sole", "Sale", "Sede", "Fede", "Sete", "Rete"], tri: ["Sapone", "Giapone", "Salame", "Sciame", "Cucina", "Cugina", "Risata", "Pirata", "Pavone", "Timone", "Mulino", "Merlino", "Pecora", "Decora", "Simile", "Umile", "Nuvola", "Tavola", "Carota", "Carrozza"] } },
    { day: 4, phase: "Facilitazione", title: "Contrasto di Sonorità", objective: "Sonori vs Sordi", words: { mono: ["Tu", "Du", "Me", "Be", "Te", "De", "Sé", "Zè", "Noi", "Voi", "Li", "Dì", "Ne", "Me", "Ci", "Gi", "Vi", "Fi"], bi: ["Dato", "Lato", "Dito", "Rito", "Gote", "Note", "Gara", "Cara", "Foto", "Voto", "Fico", "Vico", "Fame", "Lame", "Fata", "Data", "Vite", "Dite", "Vola", "Gola"], tri: ["Patata", "Batata", "Banana", "Liana", "Bibita", "Pepita", "Patatine", "Praline", "Ninnanna", "Capanna", "Marmellata", "Cancellata", "Cucinina", "Vicinina", "Ninfee", "Linee", "Amaca", "Lumaca", "Canana", "Banana"] } },
    { day: 5, phase: "Facilitazione", title: "Consonanti Nasali", objective: "Risonanze nasali", words: { mono: ["Sud", "Su", "Nord", "No", "Est", "Es", "Bar", "Par", "Bus", "Bu", "Film", "Fil", "Gas", "Ga", "Gol", "Col", "Kit", "Chi", "Led", "Le"], bi: ["Mano", "Nano", "Mela", "Vela", "Mese", "Rese", "Nave", "Fave", "Neve", "Beve", "Naso", "Vaso", "Nodo", "Modo", "Nilo", "Filo", "Muro", "Duro", "Moda", "Coda"], tri: ["Gelato", "Celato", "Melone", "Timone", "Tavolo", "Cavolo", "Balena", "Falena", "Matita", "Partita", "Divano", "Lontano", "Lumaca", "Amaca", "Pecora", "Decora", "Sirena", "Carene", "Carota", "Garota"] } },
    { day: 6, phase: "Facilitazione", title: "Focus Sillaba Iniziale", objective: "Attacco di parola", words: { mono: ["App", "Ap", "Blog", "Dog", "Boss", "Box", "Club", "Pub", "Fan", "Van", "Fax", "Fox", "Gin", "Din", "Jazz", "Gas", "Link", "Sink", "Post", "Toast"], bi: ["Pelo", "Velo", "Pila", "Fila", "Biro", "Miro", "Bere", "Pere", "Buco", "Duco", "Bacio", "Lacio", "Topo", "Dopo", "Toro", "Coro", "Tema", "Gemma", "Tana", "Lana"], tri: ["Panino", "Casino", "Limone", "Timone", "Regalo", "Slegalo", "Moneta", "Cometa", "Sedano", "Metano", "Tucano", "Vulcano", "Cucina", "Cugina", "Salame", "Reclame", "Sapone", "Giappone", "Banana", "Liana"] } },
    { day: 7, phase: "Revisione", title: "Revisione Settimana 1", objective: "Consolidamento", words: { mono: ["Re", "Tè", "Blu", "Tu", "Tre", "Re", "Se", "Te", "Si", "Ti", "No", "Do", "Ma", "Ba", "Va", "Fa", "Fa", "Va", "Da", "Ta"], bi: ["Palla", "Balla", "Bollo", "Pollo", "Casa", "Gasa", "Mare", "Pare", "Sole", "Sale", "Mamma", "Nanna", "Papà", "Pappa", "Nanna", "Mamma", "Nonno", "Tonno", "Cassa", "Tassa"], tri: ["Banana", "Liana", "Patata", "Batata", "Bibita", "Pepita", "Patatine", "Praline", "Marmellata", "Martellata", "Ninnanna", "Capanna", "Ninfee", "Linee", "Amaca", "Lumaca", "Canana", "Banana", "Cucinina", "Vicinina"] } },
    { day: 8, phase: "Variabilità", title: "Nessi Consonantici (S+C)", objective: "Nessi complessi", words: { mono: ["Mio", "Dio", "Tuo", "Suo", "Suo", "Tuo", "Cui", "Qui", "Chi", "Qui", "Che", "Te", "Quel", "Bel", "Quei", "Dei", "Ben", "Bel", "Bel", "Ben"], bi: ["Scala", "Stalla", "Scopa", "Stopa", "Scuola", "Suola", "Scava", "Sbaus", "Gesso", "Cesso", "Posta", "Tosta", "Pelle", "Belle", "Tarlo", "Carlo", "Terme", "Ferme", "Tatto", "Gatto"], tri: ["Scatola", "Spatola", "Scavare", "Lavare", "Poltrona", "Corona", "Comando", "Domanda", "Persiana", "Befana", "Spavento", "Convento", "Patente", "Potente", "Cadente", "Pendente", "Grandine", "Bandine", "Fulmini", "Culmini"] } },
    { day: 9, phase: "Variabilità", title: "Digrammi e Trigrammi", objective: "GL, GN, SC, QU", words: { mono: ["Tra", "Fra", "Fra", "Tra", "Tre", "Re", "Blu", "Giu", "Gnu", "Tu", "Sci", "Si", "Re", "Tre", "De", "Te", "Pi", "Ti", "Qu", "Tu"], bi: ["Aglio", "Olio", "Ogni", "Oni", "Bagno", "Ragno", "Legno", "Regno", "Pesce", "Pezze", "Ghiro", "Tiro", "Ghiaccio", "Laccio", "Ghianda", "Banda", "Funghi", "Lunghi", "Unghia", "Ringhia"], tri: ["Ghiandola", "Mandorla", "Ghirlanda", "Irlanda", "Cinghiale", "Maiale", "Ghiacciolo", "Lacciolo", "Ghiacciaio", "Acciaio", "Ghiaia", "Ghiaia", "Ghiotto", "Cotto", "Ghisa", "Lisa", "Disegno", "Ritegno", "Impegno", "Ingegno"] } },
    { day: 10, phase: "Variabilità", title: "Nessi in /R/ e /L/", objective: "Liquide in nesso", words: { mono: ["Po'", "Do'", "Piè", "Diè", "Mo'", "No'", "To'", "Do'", "Be'", "Me'", "Fi", "Si", "La", "Da", "Do", "To", "Re", "Te", "Mi", "Ni"], bi: ["Barca", "Parca", "Strada", "Spada", "Zampa", "Lampa", "Dente", "Gente", "Circo", "Mirco", "Busto", "Gusto", "Gusto", "Busto", "Spesa", "Pesa", "Costa", "Posta", "Pesto", "Testo"], tri: ["Triglia", "Briglia", "Tromba", "Tomba", "Trionfo", "Tonfo", "Triangolo", "Angolo", "Traffico", "Grafico", "Trasporto", "Diporto", "Tristezza", "Altezza", "Traguardo", "Sguardo", "Tradizione", "Finzione", "Trasparente", "Apparente"] } },
    { day: 11, phase: "Variabilità", title: "Doppie", objective: "Durata consonantica", words: { mono: ["No", "Nò", "Non", "Con", "Mai", "Dai", "Poi", "Noi", "Giù", "Più", "Li", "Sì", "Là", "Dà", "Qui", "Lì", "Qua", "Là", "Più", "Giù"], bi: ["Sasso", "Tasso", "Suore", "Cuore", "Rane", "Pane", "Rene", "Bene", "Bello", "Vello", "Biro", "Miro", "Beffa", "Ceppa", "Balla", "Galla", "Basta", "Pasta", "Bollo", "Pollo"], tri: ["Carrello", "Cappello", "Pennello", "Pannello", "Martello", "Mantello", "Castello", "Cestello", "Ombrello", "Stornello", "Secchiello", "Gioiello", "Mantello", "Martello", "Coltello", "Cartello", "Cammello", "Pannello", "Cancello", "Baccello"] } },
    { day: 12, phase: "Variabilità", title: "Bassa Frequenza", objective: "Parole non comuni", words: { mono: ["Sei", "Lei", "Tre", "Re", "Blu", "Tu", "Ver", "Per", "Cor", "Tor", "Sol", "Col", "Mar", "Bar", "Pan", "Van", "Can", "Van", "Don", "Ton"], bi: ["Dato", "Nato", "Dito", "Mito", "Gote", "Note", "Gara", "Bara", "Foto", "Moto", "Fico", "Mico", "Fame", "Lame", "Fata", "Data", "Vite", "Mite", "Vola", "Mola"], tri: ["Basilico", "Pacifico", "Bisonte", "Orizzonte", "Bisaccia", "Focaccia", "Focaccia", "Bisaccia", "Focolare", "Popolare", "Siepe", "Piede", "Cespuglio", "Miscuglio", "Cetriolo", "Fagiolo", "Erbario", "Sipario", "Diamante", "Amante", "Visone", "Tizzone", "Setaccio", "Abbraccio"] } },
    { day: 13, phase: "Variabilità", title: "Plurisillabi", objective: "Pattern ritmici lunghi", words: { mono: ["Col", "Sol", "Dal", "Mal", "Del", "Bel", "Dei", "Bei", "Nel", "Bel", "Sul", "Blu", "Tra", "Fra", "Fra", "Tra", "Per", "Ver", "Con", "Non"], bi: ["Spalle", "Palle", "Spende", "Pende", "Sputa", "Muta", "Stalla", "Spalla", "Stanco", "Banco", "Stoffa", "Toffa", "Spada", "Strada", "Scala", "Scuola", "Scopa", "Coppa", "Scava", "Fava"], tri: ["Fotografo", "Tipografo", "Albertino", "Clementino", "Melograno", "Veterano", "Pantofole", "Cartofole", "Ospedale", "Ospitale", "Avvocato", "Affogato", "Pomodoro", "Comodoro", "Telefono", "Citofono", "Macchina", "Bacchina", "Chitarra", "Cicala", "Comodoro", "Pomodoro", "Pomidoro", "Pomodoro", "Affogato", "Avvocato", "Citofono", "Telefono", "Telegrafo", "Fotografo", "Ospitale", "Ospedale", "Melomane", "Talismano", "Pantalone", "Canalone", "Alberino", "Ballerino", "Macina", "Cucina", "Tacchina", "Macchina", "Chiatta", "Pianta"] } },
    { day: 14, phase: "Variabilità", title: "Integrazione Mix", objective: "Sintesi finale", words: { mono: ["Re", "Tè", "Blu", "Tu", "Tre", "Re", "Se", "Te", "Si", "Ti", "No", "Do", "Ma", "Ba", "Va", "Fa", "Fa", "Va", "Da", "Ta"], bi: ["Barca", "Parca", "Strada", "Spada", "Scala", "Palla", "Pesce", "Pezze", "Aglio", "Olio", "Ogni", "Oni", "Ponte", "Fonte", "Festa", "Pesta", "Strada", "Spada", "Londra", "Tundra"], tri: ["Scatola", "Spatola", "Poltrona", "Corona", "Comando", "Domanda", "Spavento", "Convento", "Grandine", "Bandine", "Fulmini", "Culmini", "Orologio", "Prestigio", "Elefante", "Gigante", "Aquilone", "Arancione", "Altalena", "Balena"] } },
    { day: 15, phase: "Consolidamento", title: "Ripasso Finale", objective: "Rieducazione mirata sugli errori commessi.", words: { mono: [], bi: [], tri: [] } }
];

class DataService {
    static async getProtocol() {
        // Simula il fetch di un file JSON esterno
        return new Promise(resolve => setTimeout(() => resolve(clinicalProtocolJSON), 100));
    }
}

// ============================================================================
// MODULO 4: STORAGE & CACHE (IndexedDB Wrapper Sicuro)
// ============================================================================
class StorageService {
    constructor(dbName = 'EchoBridgeDB', version = 2) {
        this.dbName = dbName;
        this.version = version;
        this.db = null;
        this.initPromise = this.init();
    }

    init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('appState')) db.createObjectStore('appState');
                if (!db.objectStoreNames.contains('audioAssets')) db.createObjectStore('audioAssets');
            };
            request.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async get(key, storeName = 'appState') {
        await this.initPromise;
        return new Promise((resolve, reject) => {
            try {
                const tx = this.db.transaction(storeName, 'readonly');
                const req = tx.objectStore(storeName).get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            } catch (e) { resolve(null); } // Fallback sicuro
        });
    }

    async set(key, value, storeName = 'appState') {
        await this.initPromise;
        return new Promise((resolve, reject) => {
            try {
                const tx = this.db.transaction(storeName, 'readwrite');
                const req = tx.objectStore(storeName).put(value, key);
                req.onsuccess = () => resolve(true);
                req.onerror = () => reject(req.error);
            } catch (e) {
                console.error("Quota Exceeded or DB Error", e);
                resolve(false);
            }
        });
    }

    async clearStore(storeName) {
        await this.initPromise;
        return new Promise((resolve) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).clear().onsuccess = () => resolve();
        });
    }
}
const DB = new StorageService();

// ============================================================================
// MODULO 3: SERVICE LAYER API (Rate Limiting & Exponential Backoff)
// ============================================================================
class AudioQueueService {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        
        // Configurazione Rate Limiting
        this.DELAY_BETWEEN_REQUESTS_MS = 600;
        this.MAX_RETRIES = 3;
    }

    async getAudio(word) {
        // 1. Check rapido in cache
        const cachedBase64 = await DB.get(word, 'audioAssets');
        if (cachedBase64) return this.base64ToUrl(cachedBase64);

        // 2. Se non è in cache, lo mettiamo in coda
        return new Promise((resolve, reject) => {
            this.queue.push({ word, resolve, reject });
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;

        const task = this.queue.shift();
        let attempt = 0;
        let success = false;

        while (attempt < this.MAX_RETRIES && !success) {
            try {
                // Exponential Backoff Delay in caso di errore precedente
                if (attempt > 0) {
                    const backoffTime = Math.pow(2, attempt) * 1000;
                    console.log(`[AudioService] Retry ${attempt} per "${task.word}" tra ${backoffTime}ms`);
                    await new Promise(r => setTimeout(r, backoffTime));
                }

                // Chiamata al server Netlify
                const response = await fetch(`/.netlify/functions/generate-speech`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: task.word })
                });

                if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
                
                const data = await response.json();
                if (!data.audioData) throw new Error("Audio data missing from server");

                // Salvataggio nel DB Locale
                await DB.set(task.word, data.audioData, 'audioAssets');
                
                task.resolve(this.base64ToUrl(data.audioData));
                success = true;

            } catch (error) {
                attempt++;
                if (attempt >= this.MAX_RETRIES) {
                    console.error(`[AudioService] Fallimento totale per "${task.word}"`);
                    task.reject(error);
                }
            }
        }

        // Rate Limiting Pausa prima della prossima richiesta
        await new Promise(r => setTimeout(r, this.DELAY_BETWEEN_REQUESTS_MS));
        this.isProcessing = false;
        this.processQueue(); // Processa il prossimo in coda
    }

    base64ToUrl(base64Data) {
        try {
            const binaryString = window.atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
            
            // Header WAV
            const header = new ArrayBuffer(44); const view = new DataView(header);
            const writeString = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
            writeString(0, 'RIFF'); view.setUint32(4, 36 + bytes.length, true); writeString(8, 'WAVE'); writeString(12, 'fmt ');
            view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); // 1 Channel
            view.setUint32(24, 24000, true); view.setUint32(28, 24000 * 1 * 2, true);
            view.setUint16(32, 2, true); view.setUint16(34, 16, true); // 16 bit
            writeString(36, 'data'); view.setUint32(40, bytes.length, true);
            
            const wavBytes = new Uint8Array(header.byteLength + bytes.length);
            wavBytes.set(new Uint8Array(header), 0);
            wavBytes.set(bytes, header.byteLength);
            
            return URL.createObjectURL(new Blob([wavBytes], { type: 'audio/wav' }));
        } catch(e) { return null; }
    }
}
const AudioService = new AudioQueueService();

// Motore Fonetico (Per generare i distrattori)
class PhoneticEngine {
    constructor() {
        this.groups = [['p','b','m'], ['f','v'], ['t','d','n'], ['s','z'], ['l','r'], ['k','g'], ['ʧ','ʤ'], ['ʃ','ɲ','ʎ']];
    }
    normalize(w) { return w.toLowerCase().replace(/chi|che|ca|co|cu|q/g,'k').replace(/ghi|ghe|ga|go|gu/g,'g').replace(/ci|ce/g,'ʧ').replace(/gi|ge/g,'ʤ').replace(/sci|sce/g,'ʃ').replace(/gli/g,'ʎ').replace(/gn/g,'ɲ'); }
    dist(a, b) {
        const n1 = this.normalize(a); const n2 = this.normalize(b);
        const m = Array(n2.length+1).fill().map((_,i)=>[i]);
        for(let j=0; j<=n1.length; j++) m[0][j] = j;
        for(let i=1; i<=n2.length; i++) {
            for(let j=1; j<=n1.length; j++) {
                if(n2[i-1]===n1[j-1]) m[i][j] = m[i-1][j-1];
                else {
                    let cost = 1;
                    if(this.groups.some(g=>g.includes(n1[j-1]) && g.includes(n2[i-1]))) cost = 0.5;
                    m[i][j] = Math.min(m[i-1][j-1]+cost, m[i][j-1]+1, m[i-1][j]+1);
                }
            }
        }
        return m[n2.length][n1.length];
    }
    getDistractor(t, pool) {
        return pool.filter(w=>w.toLowerCase()!==t.toLowerCase()).map(w=>({w, d:this.dist(t,w)})).sort((a,b)=>a.d-b.d)[0]?.w || "Errore";
    }
}
const Engine = new PhoneticEngine();

// ============================================================================
// MODULO 1: GLOBAL STATE MANAGEMENT (Context API)
// ============================================================================
const AppContext = createContext(null);

function AppProvider({ children }) {
    const [isLoaded, setIsLoaded] = useState(false);
    const [patientInfo, setPatientInfo] = useState({ name: '', email: '' });
    const [unlockedDay, setUnlockedDay] = useState(1);
    const [xp, setXp] = useState(0);
    const [streak, setStreak] = useState(0);
    const [badges, setBadges] = useState([]);
    const [history, setHistory] = useState({});

    useEffect(() => {
        async function load() {
            setPatientInfo({ name: await DB.get('name') || '', email: await DB.get('email') || '' });
            setUnlockedDay(await DB.get('unlockedDay') || 1);
            setXp(await DB.get('xp') || 0);
            setStreak(await DB.get('streak') || 0);
            setBadges(await DB.get('badges') || []);
            setHistory(await DB.get('history') || {});
            setIsLoaded(true);
        }
        load();
    }, []);

    const saveState = async (updates) => {
        if (updates.patientInfo) { setPatientInfo(updates.patientInfo); await DB.set('name', updates.patientInfo.name); }
        if (updates.unlockedDay !== undefined) { setUnlockedDay(updates.unlockedDay); await DB.set('unlockedDay', updates.unlockedDay); }
        if (updates.xp !== undefined) { setXp(updates.xp); await DB.set('xp', updates.xp); }
        if (updates.streak !== undefined) { setStreak(updates.streak); await DB.set('streak', updates.streak); }
        if (updates.badges) { setBadges(updates.badges); await DB.set('badges', updates.badges); }
        if (updates.history) { setHistory(updates.history); await DB.set('history', updates.history); }
    };

    const register = (name) => saveState({ patientInfo: { name, email: '' }, badges: ['welcome'] });
    const reset = async () => {
        await DB.clearStore('appState'); await DB.clearStore('audioAssets');
        setPatientInfo({name:'',email:''}); setUnlockedDay(1); setXp(0); setStreak(0); setBadges([]); setHistory({});
    };

    if (!isLoaded) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-orange-500" size={48}/></div>;

    return (
        <AppContext.Provider value={{ patientInfo, unlockedDay, xp, streak, badges, history, saveState, register, reset }}>
            {children}
        </AppContext.Provider>
    );
}

// ============================================================================
// MODULO 2: COMPONENT ARCHITECTURE
// ============================================================================

// --- UI COMPONENT: Modale Download ---
function DownloadModal({ protocolData, day, onComplete }) {
    const [progress, setProgress] = useState(0);
    const [errorMsg, setErrorMsg] = useState(null);

    useEffect(() => {
        let isMounted = true;
        async function runDownload() {
            const data = protocolData.find(d => d.day === day);
            if (!data) return onComplete();

            const words = [...new Set([...data.words.mono, ...data.words.bi, ...data.words.tri])];
            let done = 0;

            for (let word of words) {
                if (!isMounted) break;
                try {
                    await AudioService.getAudio(word);
                } catch (e) {
                    console.warn(`Fallback per ${word}:`, e);
                    setErrorMsg("Connessione instabile. Verrà usata la voce locale per alcune parole.");
                }
                done++;
                setProgress(Math.round((done / words.length) * 100));
            }
            if(isMounted) setTimeout(onComplete, 500); // Piccola pausa al 100%
        }
        runDownload();
        return () => { isMounted = false; };
    }, [day, onComplete, protocolData]);

    return (
        <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 p-8 text-center animate-fade-in z-50 absolute inset-0">
            <Database className="mb-4 text-orange-500 animate-bounce" size={48} />
            <h3 className="text-xl font-bold text-slate-700 mb-2">Sincronizzazione</h3>
            <p className="text-sm font-medium mb-6 text-slate-500">Preparazione ambiente offline...</p>
            <div className="w-full bg-slate-200 h-3 rounded-full overflow-hidden shadow-inner">
                <div className="h-full bg-gradient-to-r from-orange-400 to-orange-600 transition-all duration-300" style={{width: `${progress}%`}}></div>
            </div>
            <p className="text-xs font-bold text-slate-400 mt-2">{progress}%</p>
            {errorMsg && <p className="text-[10px] text-red-400 mt-4 animate-pulse">{errorMsg}</p>}
        </div>
    );
}

// --- UI COMPONENT: Schermata Gioco (Game Engine) ---
function GameEngine({ day, questions, onComplete, onQuit }) {
    const [idx, setIdx] = useState(0);
    const [score, setScore] = useState(0);
    const [hist, setHist] = useState([]);
    const [status, setStatus] = useState('idle');
    const [feedback, setFeedback] = useState(null);
    const [noiseVol, setNoiseVol] = useState(0.10);
    
    // Gestione Modali Interni al Gioco
    const [showIntro, setShowIntro] = useState(day === 1);
    const [showMatrixWarning, setShowMatrixWarning] = useState(false);
    const [matrixAck, setMatrixAck] = useState(false);

    // Sistema Audio
    const audioCtxRef = useRef(null);
    const noiseRef = useRef(null);
    const gainRef = useRef(null);

    const q = questions[idx];
    const isMatrix = idx >= 6 || day === 15;

    // Cleanup audio
    useEffect(() => {
        return () => stopNoise();
    }, []);

    // Motore Logico ad ogni cambio domanda
    useEffect(() => {
        if (showIntro || feedback) return;

        if (idx === 6 && !matrixAck && day !== 15) {
            setShowMatrixWarning(true);
            stopNoise();
            return;
        }

        if (isMatrix) playNoise(noiseVol);
        else stopNoise();

        setStatus('playing');
        playVoice(q.target).then(() => setStatus('answering'));
    }, [idx, showIntro, matrixAck, feedback, isMatrix, noiseVol, q]);

    // Sistemi Audio Integrati nel componente per sicurezza
    const playVoice = async (word) => {
        try {
            const url = await AudioService.getAudio(word);
            if (!url) throw new Error("Fallback required");
            const audio = new Audio(url);
            return new Promise(res => { audio.onended = res; audio.onerror = res; audio.play().catch(res); });
        } catch (e) {
            // Fallback TTS di Sistema
            const u = new SpeechSynthesisUtterance(word);
            u.lang = 'it-IT'; u.rate = 0.9;
            window.speechSynthesis.speak(u);
            return new Promise(res => { u.onend = res; setTimeout(res, 2000); });
        }
    };

    const playNoise = (vol) => {
        if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
        if (noiseRef.current) {
            gainRef.current.gain.linearRampToValueAtTime(vol, audioCtxRef.current.currentTime + 0.5);
            return;
        }
        const bufferSize = audioCtxRef.current.sampleRate * 2;
        const buffer = audioCtxRef.current.createBuffer(1, bufferSize, audioCtxRef.current.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        noiseRef.current = audioCtxRef.current.createBufferSource();
        noiseRef.current.buffer = buffer; noiseRef.current.loop = true;
        gainRef.current = audioCtxRef.current.createGain();
        gainRef.current.gain.value = 0;
        noiseRef.current.connect(gainRef.current); gainRef.current.connect(audioCtxRef.current.destination);
        noiseRef.current.start();
        gainRef.current.gain.linearRampToValueAtTime(vol, audioCtxRef.current.currentTime + 1);
    };

    const stopNoise = () => {
        if (!noiseRef.current) return;
        gainRef.current.gain.linearRampToValueAtTime(0, audioCtxRef.current.currentTime + 0.5);
        setTimeout(() => { if (noiseRef.current) { noiseRef.current.stop(); noiseRef.current.disconnect(); noiseRef.current = null; } }, 500);
    };

    // Azioni Utente
    const handleAnswer = (ans) => {
        if (status !== 'answering') return;
        const isCorrect = ans.toLowerCase() === q.target.toLowerCase();
        
        if (isMatrix) setNoiseVol(v => isCorrect ? Math.min(0.4, v + 0.05) : Math.max(0.05, v - 0.05));
        
        setScore(s => s + (isCorrect ? 1 : 0));
        setHist(h => [...h, { target: q.target, distractor: q.distractor, selected: ans, correct: isCorrect, inputMode: q.inputMode }]);
        setFeedback({ correct: isCorrect });
    };

    const nextQ = () => {
        setFeedback(null);
        if (idx + 1 < questions.length) setIdx(i => i + 1);
        else { stopNoise(); onComplete(score, hist, day); }
    };

    return (
        <div className="absolute inset-0 bg-white flex flex-col z-20">
            {/* Overlay Istruzioni */}
            {showIntro && (
                <div className="absolute inset-0 bg-slate-900/95 z-50 flex items-center justify-center p-6 text-center">
                    <div className="bg-white p-8 rounded-3xl w-full max-w-sm">
                        <h3 className="text-2xl font-bold mb-4">Come Funziona</h3>
                        <p className="text-slate-600 mb-6 text-sm">Alza il volume. Ascolta la parola e seleziona l'opzione corretta (o scrivila).</p>
                        <button onClick={() => setShowIntro(false)} className="w-full py-4 bg-slate-900 text-white rounded-xl font-bold">Inizia</button>
                    </div>
                </div>
            )}

            {/* Overlay Matrix */}
            {showMatrixWarning && (
                <div className="absolute inset-0 bg-slate-900/95 z-50 flex items-center justify-center p-6 text-center">
                    <div className="bg-white p-8 rounded-3xl w-full max-w-sm">
                        <h3 className="text-2xl font-bold mb-4">Attenzione al Rumore</h3>
                        <p className="text-slate-600 mb-6 text-sm">Sentirai un rumore di fondo. Concentrati e individua la parola.</p>
                        <button onClick={() => { setMatrixAck(true); setShowMatrixWarning(false); }} className="w-full py-4 bg-red-600 text-white rounded-xl font-bold">Ho capito</button>
                    </div>
                </div>
            )}

            {/* Header di Gioco */}
            <div className="px-6 py-4 flex justify-between items-center bg-slate-50 border-b">
                <div><p className="text-[10px] font-bold text-slate-400">{q?.phase}</p><h3 className="font-bold text-slate-800">Giorno {day}</h3></div>
                <div className="flex items-center gap-3">
                    {isMatrix && <span className="text-[10px] font-bold px-2 py-1 bg-red-100 text-red-600 rounded">Rumore</span>}
                    <button onClick={() => { stopNoise(); onQuit(); }}><X className="text-slate-400" size={20}/></button>
                </div>
            </div>
            <div className="h-1.5 w-full bg-slate-100"><div className="h-full bg-orange-500 transition-all" style={{width: `${(idx/questions.length)*100}%`}}></div></div>

            {/* Area di Gioco / Feedback */}
            {!feedback ? (
                <div className="flex-1 flex flex-col p-6">
                    <div className="flex-1 flex items-center justify-center">
                        <button onClick={() => { if(status!=='playing') { setStatus('playing'); playVoice(q.target).then(()=>setStatus('answering')); } }} 
                                className={`w-28 h-28 rounded-full flex items-center justify-center text-4xl shadow-xl transition-all ${status==='playing'?'bg-orange-100 text-orange-600 animate-pulse':'bg-white text-slate-800'}`}>
                            <Play fill="currentColor" />
                        </button>
                    </div>
                    <div className="mt-auto min-h-[160px] flex flex-col justify-end gap-3">
                        {status === 'answering' && (
                            q.inputMode === 'text' ? (
                                <form onSubmit={e=>{e.preventDefault(); handleAnswer(e.target.elements[0].value)}} className="flex flex-col gap-3">
                                    <input type="text" autoFocus className="w-full p-4 text-center text-xl font-bold border-2 border-slate-200 rounded-xl" placeholder="Scrivi qui..." />
                                    <button type="submit" className="w-full py-4 bg-slate-900 text-white rounded-xl font-bold">Conferma</button>
                                </form>
                            ) : (
                                [q.target, q.distractor].sort(()=>0.5 - Math.random()).map(w => (
                                    <button key={w} onClick={()=>handleAnswer(w)} className="w-full py-4 bg-white border-2 border-slate-200 rounded-xl font-bold text-lg">{w}</button>
                                ))
                            )
                        )}
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center animate-fade-in">
                    <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 ${feedback.correct?'bg-green-100 text-green-600':'bg-red-100 text-red-600'}`}>
                        {feedback.correct ? <Check size={48}/> : <AlertCircle size={48}/>}
                    </div>
                    <h2 className="text-3xl font-bold mb-2">{feedback.correct ? 'Esatto!' : 'Ops!'}</h2>
                    {!feedback.correct && <p className="text-slate-500 font-medium mb-8">La parola era: <span className="font-bold text-slate-800">{q.target}</span></p>}
                    <button onClick={nextQ} className="w-full py-4 mt-8 bg-slate-900 text-white rounded-xl font-bold">Avanti</button>
                </div>
            )}
        </div>
    );
}

// ============================================================================
// MAIN APP COMPONENT (Router)
// ============================================================================
export default function App() {
    return (
        <AppProvider>
            <div className="min-h-screen bg-[#FDFBF7] font-sans text-slate-900 flex justify-center items-center">
                <style>{`
                    .custom-scroll::-webkit-scrollbar { width: 4px; }
                    .custom-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.2); border-radius: 2px; }
                    .animate-fade-in { animation: fade-in 0.3s ease-out forwards; }
                    @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
                `}</style>
                <PhoneSimulator />
            </div>
        </AppProvider>
    );
}

function PhoneSimulator() {
    const { patientInfo, unlockedDay, xp, streak, badges, saveState, register, reset } = useContext(AppContext);
    
    const [screen, setScreen] = useState('home');
    const [sessionData, setSessionData] = useState(null);
    const [protocol, setProtocol] = useState([]);

    useEffect(() => {
        DataService.getProtocol().then(setProtocol);
        if (!patientInfo.name) setScreen('registration');
    }, [patientInfo.name]);

    const handleStartSession = (day) => {
        if (day > unlockedDay) return;
        const data = protocol.find(d => d.day === day);
        if (!data) return;

        // Generazione Dinamica Coda Domande
        const qs = [];
        const addQ = (type, count, phase) => {
            for(let i=0; i<count; i++) {
                const target = data.words[type][Math.floor(Math.random() * data.words[type].length)];
                const distractor = Engine.getDistractor(target, data.words[type]);
                qs.push({ target, distractor, phase, inputMode: qs.length % 3 === 2 ? 'text' : 'choice' });
            }
        };
        addQ('mono', 3, 'WARM-UP'); addQ('bi', 5, 'CORE'); addQ('tri', 3, 'POWER'); addQ('mono', 3, 'COOL-DOWN');

        setSessionData({ day, questions: qs });
        setScreen('download'); // Passa prima dal Downloader
    };

    const handleGameComplete = async (score, hist, day) => {
        const acc = Math.round((score / hist.length) * 100);
        const passed = acc >= 70;
        
        let newXp = xp + (score * 10) + (passed ? 50 : 0);
        let newDay = passed && day === unlockedDay && unlockedDay < 15 ? unlockedDay + 1 : unlockedDay;
        
        let newBadges = [...badges];
        if (passed && !newBadges.includes('first_win')) newBadges.push('first_win');
        if (acc === 100 && !newBadges.includes('perfect')) newBadges.push('perfect');

        await saveState({ xp: newXp, unlockedDay: newDay, badges: newBadges });
        setSessionData({ ...sessionData, score, acc, passed });
        setScreen('result');
    };

    return (
        <div className="w-full max-w-[400px] h-[800px] max-h-[100dvh] bg-slate-50 flex flex-col shadow-2xl relative border-8 border-slate-800 rounded-[2.5rem] overflow-hidden">
            {/* Status Bar Simulatore */}
            <div className="bg-white p-4 border-b flex justify-between items-center z-10 shrink-0">
                <span className="text-xs font-bold text-slate-400 tracking-widest">ECHOBRIDGE</span>
                <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 rounded text-slate-600">{patientInfo.name || 'Setup'}</span>
            </div>

            {/* ROUTER VIEW */}
            <div className="flex-1 overflow-y-auto relative custom-scroll flex flex-col">
                
                {screen === 'registration' && (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-white">
                        <Smartphone className="text-orange-500 mb-6" size={48}/>
                        <h2 className="text-2xl font-bold mb-2">Paziente</h2>
                        <form onSubmit={async (e) => { 
                            e.preventDefault(); 
                            await register(e.target.elements[0].value); 
                            setScreen('home'); // <- AGGIUNTO: Comando per passare alla Home!
                        }} className="w-full">
                            <input required type="text" placeholder="Nome Paziente" className="w-full p-4 border-2 rounded-xl mb-4 font-bold text-center outline-none focus:border-orange-500" />
                            <button type="submit" className="w-full py-4 bg-slate-900 text-white font-bold rounded-xl active:scale-95">Inizia</button>
                        </form>
                    </div>
                )}

                {screen === 'home' && (
                    <div className="p-6 flex-1 flex flex-col">
                        <div className="flex justify-between items-center mb-8 bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                            <div className="flex items-center gap-2"><Star className="text-yellow-400" size={20}/><span className="font-bold">{xp} XP</span></div>
                            <div className="flex items-center gap-2"><Award className="text-orange-400" size={20}/><span className="font-bold">{badges.length} Badge</span></div>
                        </div>
                        <h2 className="text-2xl font-bold mb-6">Ciao, {patientInfo.name}!</h2>
                        
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Percorso Clinico</h3>
                        <div className="grid grid-cols-2 gap-4 flex-1 content-start">
                            {protocol.map(d => {
                                const isLocked = d.day > unlockedDay;
                                return (
                                    <div key={d.day} onClick={() => handleStartSession(d.day)} className={`relative p-4 rounded-2xl border-2 transition-all ${isLocked ? 'bg-slate-50 border-slate-100 opacity-60' : 'bg-white border-slate-200 shadow-sm cursor-pointer active:scale-95'} flex flex-col items-center text-center h-[110px] justify-center`}>
                                        {isLocked && <Lock size={20} className="absolute text-slate-300 opacity-50"/>}
                                        <span className="text-[10px] font-bold text-slate-400 uppercase">Giorno</span>
                                        <span className="text-3xl font-extrabold text-slate-800 my-1">{d.day}</span>
                                    </div>
                                );
                            })}
                        </div>
                        <button onClick={reset} className="text-xs text-red-400 underline mt-8">Svuota Cache DB</button>
                    </div>
                )}

                {screen === 'download' && (
                    <DownloadModal 
                        protocolData={protocol} 
                        day={sessionData.day} 
                        onComplete={() => setScreen('game')} 
                    />
                )}

                {screen === 'game' && (
                    <GameEngine 
                        day={sessionData.day} 
                        questions={sessionData.questions} 
                        onComplete={handleGameComplete} 
                        onQuit={() => setScreen('home')} 
                    />
                )}

                {screen === 'result' && (
                    <div className="flex-1 bg-slate-900 text-white flex flex-col items-center justify-center p-8 text-center">
                        <div className="text-6xl mb-6">🎉</div>
                        <h2 className="text-3xl font-bold mb-4">{sessionData.passed ? 'Completato!' : 'Riprova!'}</h2>
                        <div className="flex gap-4 w-full mb-8">
                            <div className="flex-1 bg-slate-800 p-4 rounded-2xl"><div className="text-3xl font-black text-orange-500">{sessionData.acc}%</div></div>
                            <div className="flex-1 bg-slate-800 p-4 rounded-2xl"><div className="text-3xl font-black text-yellow-400">+{sessionData.score*10}</div></div>
                        </div>
                        <button onClick={() => setScreen('home')} className="w-full py-4 bg-orange-600 rounded-xl font-bold text-lg active:scale-95">Torna alla Home</button>
                    </div>
                )}

            </div>
        </div>
    );
}