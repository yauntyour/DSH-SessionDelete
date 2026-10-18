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
export declare function encodeSegment(raw: string): string;
