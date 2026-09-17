/**
 * Helpers for phone-number usernames and owner-set temporary passwords.
 *
 * The server stores phone numbers as E.164 (+9665XXXXXXXX) and accepts any
 * common way of typing them at sign-in, so these only affect display.
 */

const SAUDI_MOBILE = /^\+966(5\d{8})$/

/** True for usernames that are phone numbers. */
export function isPhoneUsername(username: string): boolean {
    return username.startsWith('+')
}

/**
 * How a person would type their own login: 05XXXXXXXX for Saudi mobiles,
 * the full international number otherwise, or the plain username.
 */
export function loginHint(username: string): string {
    const saudi = SAUDI_MOBILE.exec(username)
    return saudi ? `0${saudi[1]}` : username
}

// No 0/O, 1/l/I: these get read aloud and typed on phones.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/** A temporary password like "k7mw-q2xd-p9tr" (14 characters). */
export function generateTemporaryPassword(): string {
    const bytes = new Uint8Array(12)
    crypto.getRandomValues(bytes)
    const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length])
    return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join('')).join('-')
}

/** The message the owner sends to a new or reset member. */
export function accountMessage(options: { name: string; username: string; password: string; isNew: boolean }): string {
    const signIn = `${window.location.origin}${import.meta.env.BASE_URL}login`
    const login = loginHint(options.username)
    return [
        options.isNew
            ? `مرحباً ${options.name}، حسابك في VideoScroll جاهز.`
            : `مرحباً ${options.name}، تم إعادة تعيين كلمة المرور لحسابك في VideoScroll.`,
        `تسجيل الدخول: ${signIn}`,
        `${isPhoneUsername(options.username) ? 'رقم الهاتف' : 'اسم المستخدم'}: ${login}`,
        `كلمة المرور المؤقتة: ${options.password}`,
        `سيُطلب منك اختيار كلمة مرور خاصة بك عند تسجيل الدخول.`,
    ].join('\n')
}
