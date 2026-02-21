import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey, generateSecretKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { Buffer } from 'buffer';
import { useSignMessage, useAccounts } from '@midl/react';
import { useEVMAddress } from '@midl/executor-react';

const RELAYS = [
    'wss://relay.damus.io',
    'wss://relay.primal.net',
    'wss://nos.lol',
    'wss://relay.snort.social'
];

export const NOSTR_APP_TAG = 'healthchain-v1';
export const NOSTR_SHARE_DATA_OP_TAG = `${NOSTR_APP_TAG}-datashare`;
export const NOSTR_SHARING_DATA_OP_TAG = `${NOSTR_APP_TAG}-datasharing`;
export const FEEDBACK_GROUP_CHAT_ID = '3cf3df85c1ee58b712e7296c0d2ec66a68f9b9ccc846b63d2f830d974aa447cd';

const NostrContext = createContext(null);

export const NostrProvider = ({ children }) => {
    const { isConnected, accounts } = useAccounts();
    const { signMessageAsync } = useSignMessage();
    // Derive our own EVM address from connected BTC wallet (using MIDL's key derivation)
    const myEvmAddress = useEVMAddress();

    const [pool] = useState(() => new SimplePool());
    const [privKey, setPrivKey] = useState(null);
    const [pubkey, setPubkey] = useState(null);
    const [profile, setProfile] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [nostrReady, setNostrReady] = useState(false); // true once keys are derived
    const [feedbackMessages, setFeedbackMessages] = useState([]);
    const [isLoadingFeedbackMessages, setIsLoadingFeedbackMessages] = useState(true);
    const [cachedProfiles, setCachedProfiles] = useState({});
    const [showNostrLoginModal, setShowNostrLoginModal] = useState(false);
    const [encryptedMessages, setEncryptedMessages] = useState([]);

    const openNostrLoginModal = useCallback(() => setShowNostrLoginModal(true), []);
    const closeNostrLoginModal = useCallback(() => setShowNostrLoginModal(false), []);

    const logoutNostr = useCallback(() => {
        setPubkey(null);
        setPrivKey(null);
        setProfile(null);
        setNostrReady(false);
        setEncryptedMessages([]);
        setFeedbackMessages([]);
        setCachedProfiles({});
    }, []);

    // Auto-clear Nostr identity whenever the wallet disconnects.
    // This ensures pubkey is null on next reconnect so the signature is always re-requested.
    useEffect(() => {
        if (!isConnected) {
            logoutNostr();
        }
    }, [isConnected, logoutNostr]);

    // Auto-clear Nostr identity when the active BTC account ADDRESS changes (wallet switch).
    // We track by address so that merely connecting (empty → address) does NOT trigger a reset.
    const activeAddress = accounts?.[0]?.address ?? null;
    const [lastAddress, setLastAddress] = useState(null);
    useEffect(() => {
        if (activeAddress && lastAddress && activeAddress !== lastAddress) {
            console.log('[NostrContext] Wallet account changed — clearing Nostr identity', { from: lastAddress, to: activeAddress });
            logoutNostr();
        }
        setLastAddress(activeAddress);
    }, [activeAddress]); // eslint-disable-line

    const deriveNostrKey = async (signatureBase64) => {
        const signatureBytes = Buffer.from(signatureBase64, 'base64');
        const hash = await crypto.subtle.digest('SHA-256', signatureBytes);
        return new Uint8Array(hash);
    };

    /**
     * Parse a raw Nostr kind-0 event into a profile object.
     * Health records and wallet address live in TAGS, not in the JSON content body.
     */
    const parseProfileEvent = (event) => {
        if (!event) return null;
        try {
            const content = JSON.parse(event.content);
            return {
                ...content,
                pubkey: event.pubkey,
                created_at: event.created_at,
                // Health records are stored as: ['health_record', cid, label, timestamp]
                healthRecords: event.tags
                    .filter(t => t[0] === 'health_record')
                    .map(t => ({ cid: t[1], label: t[2] || '', timestamp: parseInt(t[3] || '0') })),
                // EVM wallet address stored as: ['w', evmAddress]
                walletAddress: event.tags.find(t => t[0] === 'w')?.[1] || null,
                // Bitcoin address stored as: ['b', btcAddress]
                btcAddress: event.tags.find(t => t[0] === 'b')?.[1] || null,
                // Whether this profile has been registered with the app
                hasAppTag: event.tags.some(t => t[0] === 'A' && t[1] === NOSTR_APP_TAG),
            };
        } catch (e) {
            console.error('Failed to parse profile event', e);
            return null;
        }
    };

    const fetchProfile = useCallback(async (pkHex) => {
        setIsLoading(true);
        try {
            const event = await pool.get(RELAYS, { kinds: [0], authors: [pkHex] });
            const parsed = parseProfileEvent(event);
            setProfile(parsed);
            if (parsed) setCachedProfiles(prev => ({ ...prev, [pkHex]: parsed }));
        } catch (error) {
            console.error("Error fetching Nostr profile:", error);
            setProfile(null);
        } finally {
            setIsLoading(false);
        }
    }, [pool]);

    // Publish a minimal discovery profile so this user appears in UsersDirectory
    const publishDiscoveryProfile = useCallback(async (pk, sk, walletAddr, existingProfile, btcAddr) => {
        // Only publish if no profile exists yet, or if it's missing the app tag
        const content = JSON.stringify({
            name: existingProfile?.name || '',
            about: existingProfile?.about || 'HealthDataSwap user',
            picture: existingProfile?.picture || '',
        });
        const tags = [['A', NOSTR_APP_TAG]];
        if (walletAddr) tags.push(['w', walletAddr]);
        if (btcAddr) tags.push(['b', btcAddr]);
        // Preserve existing health records
        for (const rec of (existingProfile?.healthRecords ?? [])) {
            tags.push(['health_record', rec.cid, rec.label || '', String(rec.timestamp || '')]);
        }
        const eventTemplate = {
            kind: 0,
            created_at: Math.floor(Date.now() / 1000),
            tags,
            content,
        };
        try {
            const signedEvent = finalizeEvent({ ...eventTemplate, pubkey: pk }, sk);
            await Promise.any(pool.publish(RELAYS, signedEvent));
            console.log('Discovery profile published to Nostr');
        } catch (e) {
            console.warn('Failed to publish discovery profile:', e);
        }
    }, [pool]);

    const connectWithMidl = useCallback(async () => {
        console.log("DEBUG: connectWithMidl triggered", { isConnected, hasAccounts: accounts?.length > 0 });
        if (!isConnected || !accounts?.[0]) {
            console.warn("Nostr derivation attempted but wallet is not connected yet.");
            return null;
        }
        setIsLoading(true);
        try {
            const messageToSign = "Sign this message to login to Nostr via MIDL. This generates your deterministic keys.";
            const response = await signMessageAsync({
                message: messageToSign,
                address: accounts[0].address
            });
            const sk = await deriveNostrKey(response.signature);
            const pk = getPublicKey(sk);
            setPrivKey(sk);
            setPubkey(pk);
            // Fetch the existing raw event so we can preserve tags
            let existingRawEvent = null;
            try {
                existingRawEvent = await pool.get(RELAYS, { kinds: [0], authors: [pk] });
            } catch (_) { }
            const existingParsed = parseProfileEvent(existingRawEvent);
            // Only publish a discovery profile if the A tag is missing,
            // OR if the existing profile has no proper EVM address saved yet.
            const validEvmAddress = myEvmAddress && myEvmAddress.startsWith('0x') && myEvmAddress !== '0x0000000000000000000000000000000000000000'
                ? myEvmAddress : '';
            const btcAddress = accounts[0]?.address || '';
            const profileHasBadAddress = existingParsed?.hasAppTag && existingParsed?.walletAddress && !existingParsed.walletAddress.startsWith('0x');
            if (!existingParsed?.hasAppTag || profileHasBadAddress) {
                await publishDiscoveryProfile(pk, sk, validEvmAddress, existingParsed, btcAddress);
            } else if (existingParsed?.hasAppTag && !existingParsed?.walletAddress && validEvmAddress) {
                // Profile exists but is missing EVM address — update it
                await publishDiscoveryProfile(pk, sk, validEvmAddress, existingParsed, btcAddress);
            }
            // Set local state from the authoritative relay data
            if (existingParsed) {
                setProfile(existingParsed);
                setCachedProfiles(prev => ({ ...prev, [pk]: existingParsed }));
            } else {
                await fetchProfile(pk);
            }
            setNostrReady(true);
            closeNostrLoginModal();
            return { pubkey: pk, privKey: sk };
        } catch (error) {
            console.error("Nostr Login (MIDL) Error:", error);
            if (isConnected && accounts?.[0]) {
                alert(error.message || "Failed to derive Nostr identity.");
            }
            logoutNostr();
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [isConnected, accounts, signMessageAsync, fetchProfile, closeNostrLoginModal, logoutNostr]);

    const generateAndConnectKeys = useCallback(async () => {
        setIsLoading(true);
        try {
            logoutNostr();
            const newPrivKey = generateSecretKey();
            const newPubKey = getPublicKey(newPrivKey);
            setPrivKey(newPrivKey);
            setPubkey(newPubKey);
            await fetchProfile(newPubKey);
            closeNostrLoginModal();
            console.log("Generated NSEC:", nip19.nsecEncode(newPrivKey));
            console.log("Generated NPUB:", nip19.npubEncode(newPubKey));
            return { pubkey: newPubKey, privKey: newPrivKey };
        } catch (error) {
            console.error("Nostr Key Generation Error:", error);
            alert(error.message || "Failed to generate new Nostr keys.");
            logoutNostr();
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [fetchProfile, closeNostrLoginModal, logoutNostr]);

    /**
     * Update profile (kind 0) with optional health records and wallet address.
     * Health records are stored as tags: ['health_record', cid, label, timestamp]
     * Wallet address stored as tag: ['w', address]
     */
    const updateProfile = useCallback(async ({ name, about, picture, walletAddress, healthRecords } = {}) => {
        if (!pubkey || !privKey) throw new Error("Not logged in to Nostr.");

        // Merge with existing profile data
        const existingProfile = profile || {};
        const mergedName = name ?? existingProfile.name ?? '';
        const mergedAbout = about ?? existingProfile.about ?? '';
        const mergedPicture = picture ?? existingProfile.picture ?? '';
        const mergedWallet = walletAddress ?? existingProfile.walletAddress ?? '';
        const mergedRecords = healthRecords ?? existingProfile.healthRecords ?? [];

        const content = JSON.stringify({
            name: mergedName,
            about: mergedAbout,
            picture: mergedPicture,
        });

        const tags = [['A', NOSTR_APP_TAG]];
        if (mergedWallet) tags.push(['w', mergedWallet]);
        for (const rec of mergedRecords) {
            tags.push(['health_record', rec.cid, rec.label || '', String(rec.timestamp || Math.floor(Date.now() / 1000))]);
        }

        const eventTemplate = {
            kind: 0,
            created_at: Math.floor(Date.now() / 1000),
            tags,
            content,
        };

        try {
            const signedEvent = finalizeEvent({ ...eventTemplate, pubkey }, privKey);
            await Promise.any(pool.publish(RELAYS, signedEvent));

            const updatedProfile = {
                name: mergedName,
                about: mergedAbout,
                picture: mergedPicture,
                walletAddress: mergedWallet,
                healthRecords: mergedRecords,
                pubkey,
                created_at: eventTemplate.created_at,
            };
            setProfile(updatedProfile);
            setCachedProfiles(prev => ({ ...prev, [pubkey]: updatedProfile }));
        } catch (error) {
            console.error("Failed to update profile", error);
            throw new Error("Could not save profile to the network.");
        }
    }, [pubkey, privKey, profile, pool]);

    /**
     * Add a health record CID to the user's Nostr profile.
     * Encrypts data, then updates the kind-0 profile with a new health_record tag.
     */
    const addHealthRecord = useCallback(async ({ cid, label }) => {
        if (!pubkey || !privKey) throw new Error("Not logged in to Nostr.");

        const existingRecords = profile?.healthRecords ?? [];
        const newRecord = { cid, label: label || 'Health Record', timestamp: Math.floor(Date.now() / 1000) };
        const updatedRecords = [...existingRecords, newRecord];

        await updateProfile({ healthRecords: updatedRecords });
        return newRecord;
    }, [pubkey, privKey, profile, updateProfile]);

    /**
     * Clear all health records from the user's Nostr profile.
     */
    const clearHealthRecords = useCallback(async () => {
        if (!pubkey || !privKey) throw new Error("Not logged in to Nostr.");
        await updateProfile({ healthRecords: [] });
    }, [pubkey, privKey, updateProfile]);

    const sendEncryptedDM = useCallback(async (recipientPubkey, message, dataCid, sharing, originalCID) => {
        if (!pubkey || !privKey) throw new Error("Not logged in with private key.");

        try {
            const { nip04 } = await import('nostr-tools');
            const encryptedContent = await nip04.encrypt(privKey, recipientPubkey, message);

            const OP_TAG = sharing ? NOSTR_SHARING_DATA_OP_TAG : NOSTR_SHARE_DATA_OP_TAG;
            const tags = [
                ['p', recipientPubkey],
                ['A', NOSTR_APP_TAG],
                ['O', OP_TAG],
                ['C', dataCid]
            ];
            if (sharing && originalCID) tags.push(['I', originalCID]);

            const eventTemplate = {
                kind: 4,
                created_at: Math.floor(Date.now() / 1000),
                tags,
                content: encryptedContent,
            };

            const signedEvent = finalizeEvent({ ...eventTemplate, pubkey }, privKey);
            await Promise.any(pool.publish(RELAYS, signedEvent));
            return signedEvent.id;
        } catch (error) {
            console.error("Failed to send encrypted DM:", error);
            throw error;
        }
    }, [pubkey, privKey, pool]);

    const decryptDM = useCallback(async (event) => {
        if (!privKey) return null;
        try {
            const { nip04 } = await import('nostr-tools');
            const otherPubkey = event.pubkey === pubkey
                ? event.tags.find(t => t[0] === 'p')?.[1] // Get recipient from 'p' tag (can be self for backups)
                : event.pubkey;
            if (!otherPubkey) return null;
            return await nip04.decrypt(privKey, otherPubkey, event.content);
        } catch (error) {
            console.error("Error decrypting DM:", error);
            return null;
        }
    }, [privKey, pubkey]);

    const fetchProfileByWalletAddress = useCallback(async (walletAddr) => {
        try {
            const event = await pool.get(RELAYS, { kinds: [0], "#w": [walletAddr] });
            if (event) {
                try {
                    return { ...JSON.parse(event.content), pubkey: event.pubkey, created_at: event.created_at };
                } catch (e) {
                    console.error("Failed to parse profile JSON", e);
                }
            }
            return null;
        } catch (error) {
            console.error("Error fetching Nostr profile by wallet address:", error);
            return null;
        }
    }, [pool]);

    const fetchProfileByPubkey = useCallback(async (targetPubkey) => {
        if (!targetPubkey) return null;
        if (cachedProfiles[targetPubkey]) return cachedProfiles[targetPubkey];
        try {
            const event = await pool.get(RELAYS, { kinds: [0], authors: [targetPubkey] });
            if (event) {
                const content = JSON.parse(event.content);
                const fullProfile = { ...content, pubkey: event.pubkey, created_at: event.created_at };
                setCachedProfiles(prev => ({ ...prev, [targetPubkey]: fullProfile }));
                return fullProfile;
            }
            return null;
        } catch (error) {
            console.error(`Error fetching Nostr profile for pubkey ${targetPubkey}:`, error);
            return null;
        }
    }, [pool, cachedProfiles]);

    const fetchAllProfiles = useCallback(async () => {
        try {
            const events = await pool.querySync(RELAYS, { kinds: [0], '#A': [NOSTR_APP_TAG] });
            const profilesMap = new Map();
            for (const event of events) {
                const parsed = parseProfileEvent(event);
                if (!parsed) continue;
                const existing = profilesMap.get(event.pubkey);
                if (!existing || event.created_at > existing.created_at) {
                    profilesMap.set(event.pubkey, parsed);
                }
            }
            const fetchedProfiles = Array.from(profilesMap.values());
            setCachedProfiles(prev => {
                const newCache = { ...prev };
                fetchedProfiles.forEach(p => { if (p.pubkey) newCache[p.pubkey] = p; });
                return newCache;
            });
            return fetchedProfiles;
        } catch (error) {
            console.error("Error fetching all Nostr profiles:", error);
            return [];
        }
    }, [pool]);

    const getNostrTime = useCallback((timestamp) => {
        const date = new Date(timestamp * 1000);
        const diffTime = Math.abs(new Date().getTime() - date.getTime());
        const diffMinutes = Math.ceil(diffTime / (1000 * 60));
        const diffHours = Math.ceil(diffTime / (1000 * 60 * 60));
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffMinutes < 60) return `${diffMinutes}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    }, []);

    const sendFeedback = useCallback(async (message, groupChatId) => {
        if (!pubkey || !privKey) throw new Error("User not logged in to Nostr.");
        const tags = [['e', groupChatId, '', 'root'], ['p', pubkey, ''], ['t', 'feedback']];
        const eventTemplate = {
            kind: 42,
            created_at: Math.floor(Date.now() / 1000),
            tags,
            content: message.trim(),
        };
        try {
            const signedEvent = finalizeEvent({ ...eventTemplate, pubkey }, privKey);
            await Promise.any(pool.publish(RELAYS, signedEvent));
            setFeedbackMessages(prev => [...prev, signedEvent].sort((a, b) => a.created_at - b.created_at));
        } catch (err) {
            console.error("Failed to publish feedback:", err);
            throw err;
        }
    }, [privKey, pubkey, pool]);

    const subscribeToDMs = useCallback(async (OP_TAG, originalCID) => {
        if (!pubkey) return () => { };
        const filter = originalCID
            ? { kinds: [4], authors: [pubkey], '#A': [NOSTR_APP_TAG], '#O': [OP_TAG], '#I': [originalCID] }
            : { kinds: [4], '#p': [pubkey], '#A': [NOSTR_APP_TAG], '#O': [OP_TAG] };
        const events = await pool.querySync(RELAYS, filter);
        setEncryptedMessages(events);
        return () => { };
    }, [pubkey, pool]);

    const getProfileForMessage = useCallback((targetPubkey) => {
        if (cachedProfiles[targetPubkey]) return cachedProfiles[targetPubkey];
        fetchProfileByPubkey(targetPubkey);
        return undefined;
    }, [cachedProfiles, fetchProfileByPubkey]);

    useEffect(() => {
        const filter = { kinds: [42], '#e': [FEEDBACK_GROUP_CHAT_ID], limit: 50 };
        const sub = pool.subscribe(RELAYS, filter, {
            onevent: (event) => {
                setFeedbackMessages(prev => {
                    if (!prev.some(msg => msg.id === event.id)) {
                        return [...prev, event].sort((a, b) => a.created_at - b.created_at);
                    }
                    return prev;
                });
                setIsLoadingFeedbackMessages(false);
            },
            oneose: () => setIsLoadingFeedbackMessages(false)
        });
        return () => sub.close();
    }, [pool]);

    useEffect(() => {
        return () => { pool.close(RELAYS); };
    }, [pool]);

    return (
        <NostrContext.Provider value={{
            pubkey, privKey, profile,
            nostrReady,
            connectWithMidl,
            generateAndConnectKeys,
            updateProfile,
            addHealthRecord,
            clearHealthRecords,
            fetchProfileByWalletAddress,
            fetchAllProfiles,
            fetchProfileByPubkey,
            isLoading,
            feedbackMessages,
            isLoadingFeedbackMessages,
            sendFeedback,
            getNostrTime,
            getProfileForMessage,
            showNostrLoginModal,
            openNostrLoginModal,
            closeNostrLoginModal,
            logoutNostr,
            decryptDM,
            subscribeToDMs,
            sendEncryptedDM,
            encryptedMessages,
            pool,
            RELAYS
        }}>
            {children}
        </NostrContext.Provider>
    );
};

export const useNostr = () => {
    const context = useContext(NostrContext);
    if (!context) throw new Error('useNostr must be used within NostrProvider');
    return context;
};
