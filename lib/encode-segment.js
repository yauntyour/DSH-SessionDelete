/**
 * Encode a session id as one safe path segment, injectively over ALL JS
 * (UTF-16) strings — including lone surrogates. This is the same encoding
 * @deepseek-ai/dsh-session-persistence-jsonl applies to session ids before
 * any filesystem use; the deletion path re-implements it so the session
 * directory can be verified before it is removed. Safe code units stay
 * literal; every other unit, including `~`, becomes `~XXXX`.
 *
 * @param raw - the session id to encode; must be non-empty.
 * @returns the escaped single path segment, decodable back to `raw`.
 */
export function encodeSegment(raw) {
    if (raw.length === 0)
        throw new Error('cannot encode an empty path segment');
    if (raw === '.')
        return '~002E';
    if (raw === '..')
        return '~002E~002E';
    let out = '';
    for (let i = 0; i < raw.length; i++) {
        const code = raw.charCodeAt(i);
        const ch = String.fromCharCode(code);
        if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch))
            out += ch;
        else
            out += '~' + code.toString(16).toUpperCase().padStart(4, '0');
    }
    return out;
}
