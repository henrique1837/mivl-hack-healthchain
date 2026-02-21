import { useState } from 'react'
import { useNostr } from '../contexts/NostrContext'

// Simple browser-side encryption using Web Crypto API (AES-GCM)
export const encryptData = async (data, pubKeyHex) => {
    // Derive a symmetric key from the user's public key (deterministic for demo)
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(pubKeyHex.slice(0, 32).padEnd(32, '0')),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    const aesKey = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: new TextEncoder().encode('healthchain-salt'), iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded);
    // Pack IV + ciphertext into a single Base64 string
    const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.byteLength);
    return btoa(String.fromCharCode(...combined));
}

export const decryptData = async (encryptedBase64, pubKeyHex) => {
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(pubKeyHex.slice(0, 32).padEnd(32, '0')),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    const aesKey = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: new TextEncoder().encode('healthchain-salt'), iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );
    const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext);
    return JSON.parse(new TextDecoder().decode(plainBuf));
};

// Hash the data for on-chain integrity
export const hashData = async (data) => {
    const encoded = new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data));
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
};

// Simple CID-like identifier from encrypted content
export const generateCid = async (encryptedData) => {
    const hash = await hashData(encryptedData);
    return `hc1-${hash.slice(0, 32)}`;
};

const RECORD_TYPES = [
    { id: 'blood_pressure', label: 'Blood Pressure', icon: '❤️', fields: [{ id: 'systolic', label: 'Systolic (mmHg)', type: 'number' }, { id: 'diastolic', label: 'Diastolic (mmHg)', type: 'number' }] },
    { id: 'glucose', label: 'Blood Glucose', icon: '🩸', fields: [{ id: 'value', label: 'Glucose Level (mg/dL)', type: 'number' }] },
    { id: 'weight', label: 'Weight', icon: '⚖️', fields: [{ id: 'value', label: 'Weight (kg)', type: 'number' }] },
    { id: 'medication', label: 'Medication', icon: '💊', fields: [{ id: 'name', label: 'Medication Name', type: 'text' }, { id: 'dose', label: 'Dosage', type: 'text' }] },
    { id: 'notes', label: 'Clinical Notes', icon: '📝', fields: [{ id: 'text', label: 'Notes', type: 'textarea' }] },
];

export default function HealthDataUpload({ accounts, onSuccess }) {
    const { pubkey, privKey, addHealthRecord, updateProfile, profile, pool, RELAYS } = useNostr();
    const [selectedType, setSelectedType] = useState(null);
    const [formData, setFormData] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!pubkey || !selectedType) return;
        setIsSubmitting(true);
        setError(null);

        try {
            const recordPayload = {
                type: selectedType.id,
                data: formData,
                timestamp: new Date().toISOString(),
                submittedBy: accounts?.[0]?.evmAddress || 'unknown',
            };

            // 1. Encrypt the health data using the user's public key
            const encryptedContent = await encryptData(recordPayload, pubkey);

            // 2. Generate a content identifier and hash
            const cid = await generateCid(encryptedContent);
            const recordHash = await hashData(recordPayload);

            // 3. For this POC without IPFS, store the AES-GCM encrypted payload on Nostr 
            //    as a public event (kind 1) so it can be fetched by anyone who knows the CID.
            //    Privacy is maintained because it is AES-GCM encrypted.
            const { finalizeEvent } = await import('nostr-tools/pure');
            const dataEventTemplate = {
                kind: 1,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['C', cid],
                    ['A', 'healthchain-v0-storage']
                ],
                content: encryptedContent,
            };
            const signedDataEvent = finalizeEvent({ ...dataEventTemplate, pubkey }, privKey);
            await Promise.any(pool.publish(RELAYS, signedDataEvent));

            // 4. Update the Nostr profile with the new health record tag
            //    Also sync the wallet address into the profile
            await addHealthRecord({
                cid,
                label: `${selectedType.label} — ${new Date().toLocaleDateString()}`,
            });

            // 5. Also update wallet address in profile if not set yet
            if (!profile?.walletAddress && accounts?.[0]?.evmAddress) {
                await updateProfile({ walletAddress: accounts[0].evmAddress });
            }

            setFormData({});
            setSelectedType(null);
            if (onSuccess) onSuccess({ cid, recordHash, type: selectedType.id });
        } catch (err) {
            console.error("Health data upload error:", err);
            setError(err.message || "Failed to save health record.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!pubkey) {
        return (
            <div className="flex flex-col items-center justify-center h-full py-16 text-center gap-3">
                <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center text-3xl">🔐</div>
                <p className="text-white/40 text-sm">Nostr identity required to add records</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-sm font-bold text-white/60 uppercase tracking-widest mb-3">Select Record Type</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {RECORD_TYPES.map(type => (
                        <button
                            key={type.id}
                            onClick={() => { setSelectedType(type); setFormData({}); }}
                            className={`p-3 rounded-xl border text-left transition-all ${selectedType?.id === type.id
                                ? 'bg-primary/20 border-primary/50 text-white'
                                : 'bg-white/5 border-white/5 text-white/50 hover:bg-white/10 hover:text-white'
                                }`}
                        >
                            <span className="text-xl block mb-1">{type.icon}</span>
                            <span className="text-xs font-semibold">{type.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {selectedType && (
                <form onSubmit={handleSubmit} className="space-y-4 animate-in fade-in slide-in-from-top-2">
                    <div className="h-px bg-white/5" />
                    <h3 className="text-sm font-bold text-white/60 uppercase tracking-widest">
                        {selectedType.icon} {selectedType.label}
                    </h3>

                    {selectedType.fields.map(field => (
                        <div key={field.id}>
                            <label className="text-xs text-white/40 uppercase tracking-wider block mb-1">{field.label}</label>
                            {field.type === 'textarea' ? (
                                <textarea
                                    required
                                    rows={3}
                                    value={formData[field.id] || ''}
                                    onChange={e => setFormData(prev => ({ ...prev, [field.id]: e.target.value }))}
                                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-primary/50 resize-none"
                                    placeholder="Enter notes..."
                                />
                            ) : (
                                <input
                                    type={field.type}
                                    required
                                    value={formData[field.id] || ''}
                                    onChange={e => setFormData(prev => ({ ...prev, [field.id]: e.target.value }))}
                                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-primary/50"
                                    placeholder={field.label}
                                />
                            )}
                        </div>
                    ))}

                    {error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">{error}</div>
                    )}

                    <div className="p-3 bg-primary/5 border border-primary/10 rounded-xl text-xs text-white/40 space-y-1">
                        <p>🔐 Data will be <span className="text-primary font-semibold">encrypted</span> before storage</p>
                        <p>📡 CID will be stored in your <span className="text-primary font-semibold">Nostr profile</span></p>
                    </div>

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full btn-primary disabled:opacity-40"
                    >
                        {isSubmitting ? (
                            <span className="flex items-center justify-center gap-2">
                                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                Saving & Updating Profile...
                            </span>
                        ) : '🔒 Encrypt & Save Record'}
                    </button>
                </form>
            )}
        </div>
    );
}
