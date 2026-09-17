/**
 * Arabic text for the error codes the server sends
 * (server/internal/httpapi/errors.go). A code missing here falls back to the
 * server's English message, so add new codes on both sides together.
 */
const MESSAGES: Record<string, string> = {
    network_error: 'تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.',
    invalid_request: 'تعذر تنفيذ الطلب. حاول مرة أخرى.',
    origin_not_allowed: 'هذا الموقع غير مسموح له بالاتصال بالخادم.',
    not_found: 'العنصر المطلوب غير موجود.',
    video_not_found: 'الفيديو غير موجود.',
    server_error: 'حدث خطأ في الخادم. حاول مرة أخرى لاحقاً.',

    sign_in_required: 'يرجى تسجيل الدخول.',
    session_expired: 'انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.',
    invalid_credentials: 'رقم الهاتف أو اسم المستخدم أو كلمة المرور غير صحيحة.',
    wrong_current_password: 'كلمة المرور الحالية غير صحيحة.',
    same_password: 'اختر كلمة مرور مختلفة عن الحالية.',
    rate_limited: 'محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.',
    use_profile_password: 'غيّر كلمة المرور الخاصة بك من صفحة الملف الشخصي.',
    password_change_required: 'يرجى اختيار كلمة مرور جديدة أولاً.',

    owner_only: 'هذه الصفحة للمالك فقط.',
    forbidden: 'ليست لديك صلاحية لتنفيذ هذا الإجراء.',
    cannot_upload: 'حسابك لا يملك صلاحية رفع الفيديوهات.',
    not_your_video: 'يمكن للمالك أو ناشر الفيديو فقط تعديله أو حذفه.',
    cannot_delete_self: 'لا يمكنك حذف حسابك الخاص.',

    username_taken: 'يوجد حساب بهذا الرقم أو اسم المستخدم مسبقاً.',
    invalid_username: 'استخدم رقم هاتف، أو اسم مستخدم من 3 إلى 32 حرفاً (أحرف إنجليزية وأرقام و . - _).',
    invalid_phone: 'رقم الهاتف غير صحيح. اكتبه بالشكل 05XXXXXXXX، أو بالرمز الدولي مثل ‎+9665XXXXXXXX.',
    weak_password: 'يجب أن تتكون كلمة المرور من 10 أحرف على الأقل.',
    invalid_name: 'يجب أن يكون الاسم من 1 إلى 48 حرفاً.',
    invalid_role: 'الصلاحية المختارة غير صحيحة.',
    invite_invalid: 'رابط الدعوة غير صالح أو منتهي الصلاحية أو مستخدم مسبقاً.',
    last_owner: 'يجب أن يبقى مالك واحد نشط على الأقل.',

    upload_not_found: 'لم يُعثر على عملية الرفع.',
    unsupported_format: 'صيغة الفيديو غير مدعومة.',
    file_too_large: 'حجم الفيديو أكبر من الحد المسموح.',
    disk_full: 'لا توجد مساحة كافية على الخادم لهذا الفيديو.',
    upload_busy: 'هذا الملف قيد الرفع بالفعل من نافذة أخرى.',
    upload_closed: 'اكتمل رفع هذا الملف بالفعل.',
    upload_invalid: 'حدث خطأ أثناء الرفع. اختر الملف مرة أخرى للمتابعة.',
    upload_offset_mismatch: 'جارٍ استئناف الرفع…',
    invalid_title: 'يجب أن يكون العنوان من 1 إلى 120 حرفاً.',
}

/** The Arabic message for a server error code, if there is one. */
export function messageForCode(code: unknown): string | undefined {
    return typeof code === 'string' ? MESSAGES[code] : undefined
}
