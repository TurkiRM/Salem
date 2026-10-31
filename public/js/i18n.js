/* Salem — Arabic / English strings */
(function () {
  const S = (window.Salem = window.Salem || {});

  const ar = {
    hero_title: 'العين على الطريق، لا على الشاشة',
    hero_sub: 'يرصد سالم انشغال السائق بجواله أثناء القيادة من خلال حركة العين، ويرسل لقطة فورية للمشرف مع الموقع والسرعة.',
    fact_1: 'نظر متواصل للشاشة أثناء الحركة يُسجَّل كمخالفة مع صورة.',
    fact_2: 'الموقع والسرعة لحظة المخالفة على الخريطة.',
    fact_3: 'المراقبة بطلب من المشرف ولمدة محددة، وبموافقة السائق.',
    staff_login: 'دخول المشرفين', email: 'البريد الإلكتروني', password: 'كلمة المرور', sign_in: 'دخول', sign_out: 'خروج',
    are_you_driver: 'أنت سائق؟', driver_hint: 'افتح صفحة السائق من جوالك وادخل برمز الشركة ورقم جوالك والرمز السري.', open_driver: 'فتح صفحة السائق',

    nav_overview: 'المتابعة المباشرة', nav_alerts: 'المخالفات', nav_drivers: 'السائقون', nav_history: 'سجل الطلبات', nav_settings: 'الإعدادات',
    overview_sub: 'السائقون تحت المراقبة الآن، والطلبات بانتظار موافقة السائق.',
    send_request: 'طلب مراقبة', live_sessions: 'الجلسات الحالية', latest_alerts: 'آخر المخالفات', view_all: 'عرض الكل',
    kpi_active: 'تحت المراقبة', kpi_pending: 'بانتظار السائق', kpi_gaze_today: 'نظر للشاشة اليوم', kpi_events_today: 'كل التنبيهات اليوم', kpi_to_review: 'بانتظار المراجعة', kpi_drivers: 'السائقون',
    updated_at: 'آخر تحديث {t}',
    no_live: 'لا توجد جلسات مراقبة الآن', no_live_hint: 'أرسل طلب مراقبة لسائق، وستظهر الجلسة هنا فور موافقته.',
    waiting_driver: 'بانتظار موافقة السائق على مراقبة لمدة {d}.', sent: 'أُرسل',
    speed: 'السرعة', kmh: 'كم/س', alerts: 'المخالفات', remaining: 'المتبقي', last_signal: 'آخر إشارة', map: 'الخريطة', details: 'التفاصيل', stop: 'إيقاف',
    conn_lost: 'انقطع الاتصال', ds_watching: 'يراقب الآن', ds_calibrating: 'يجهّز', ds_no_face: 'الوجه غير ظاهر', ds_away: 'خرج من التطبيق', ds_parked: 'متوقف',
    confirm_stop_title: 'إيقاف المراقبة؟', confirm_stop_body: 'ستتوقف المراقبة على جوال السائق فوراً.', back: 'رجوع', stopped: 'تم الإيقاف',

    alerts_sub: 'كل مخالفة معها صورة لحظتها والسرعة والموقع. راجعها ثم أكدها أو ارفضها.',
    all_types: 'كل الأنواع', all_reviews: 'كل الحالات', all_drivers: 'كل السائقين',
    ev_gaze: 'نظر للشاشة', ev_left_screen: 'خرج من سالم', ev_face_lost: 'الوجه غير ظاهر', ev_ended_early: 'أنهى المراقبة مبكراً',
    rv_new: 'جديدة', rv_confirmed: 'مؤكدة', rv_dismissed: 'مرفوضة',
    confirm: 'تأكيد', dismiss: 'رفض', lasted: 'المدة', reading_pattern: 'نمط قراءة/كتابة', view_photo: 'عرض الصورة',
    no_events: 'لا توجد مخالفات', no_events_hint: 'ستظهر هنا المخالفات المرصودة أثناء جلسات المراقبة.', no_events_session: 'لا توجد مخالفات في هذه الجلسة حتى الآن.',
    driver: 'السائق', type: 'النوع', time: 'الوقت', location: 'الموقع', eye_pattern: 'حركة العين', saccades: 'قفزات', steady_look: 'نظرة ثابتة',
    minutes_left: 'الدقائق المتبقية', no_photo: 'لا توجد صورة لهذا النوع', review_note: 'ملاحظة المراجعة', saved: 'تم الحفظ',

    drivers_sub: 'أضف سائقيك وأرسل لهم بيانات الدخول. التقييم محسوب من آخر 30 يوماً.',
    add_driver: 'إضافة سائق', score: 'التقييم', hours_watched: 'ساعات المراقبة', last_session: 'آخر جلسة',
    reset_pin: 'رمز جديد', disable: 'تعطيل', enable: 'تفعيل', enabled: 'مفعّلة', disabled: 'معطّلة',
    no_drivers: 'لا يوجد سائقون بعد', no_drivers_hint: 'أضف أول سائق لترسل له طلب مراقبة.',
    full_name: 'الاسم', phone: 'رقم الجوال', vehicle: 'المركبة', vehicle_ph: 'مثال: هايلكس — أ ب ج 1234', add: 'إضافة', cancel: 'إلغاء',
    driver_credentials: 'بيانات دخول السائق', cred_once: 'احفظ الرمز السري الآن، لن يظهر مرة أخرى. أرسله للسائق.',
    pin: 'الرمز السري', copy_message: 'نسخ الرسالة', done: 'تم', copied: 'تم النسخ',
    cred_message: 'مرحباً {name}،\nللدخول إلى تطبيق سالم:\n{link}\nرمز الشركة: {code}\nرقم الجوال: {phone}\nالرمز السري: {pin}',
    add_driver_first: 'أضف سائقاً أولاً',
    watch_for: 'مدة المراقبة', custom: 'مدة أخرى', minutes: 'بالدقائق', note_to_driver: 'رسالة للسائق (اختياري)', note_ph: 'مثال: رحلة الرياض — القصيم',
    test_mode: 'وضع التجربة', test_mode_hint: 'يرصد حتى لو كانت السيارة واقفة. استخدمه للتجربة فقط.', test_mode_short: 'تجربة',
    send: 'إرسال', request_sent: 'تم إرسال الطلب للسائق',
    session_details: 'تفاصيل الجلسة', started: 'بدأت', ends: 'تنتهي',

    history_sub: 'كل طلبات المراقبة وحالتها وعدد المخالفات في كل جلسة.', no_history: 'لا توجد طلبات بعد',
    status: 'الحالة', duration: 'المدة', requested_by: 'المشرف',
    st_pending: 'بانتظار السائق', st_active: 'جارية', st_completed: 'اكتملت', st_declined: 'رفضها السائق', st_expired: 'انتهت صلاحيتها', st_cancelled: 'أوقفها المشرف', st_ended_early: 'أنهاها السائق مبكراً',

    detection_rules: 'قواعد الرصد', gaze_seconds: 'مدة النظر للشاشة قبل التسجيل (ثوانٍ)', min_speed: 'أقل سرعة تُعتبر فيها السيارة متحركة (كم/س)',
    face_lost_seconds: 'مدة اختفاء الوجه قبل التسجيل (ثوانٍ)',
    face_lost_hint: 'إذا لم تظهر عينا السائق للكاميرا طوال هذه المدة أثناء الحركة (تغطية الكاميرا أو تحويل الجوال) تُسجَّل مخالفة "الوجه غير ظاهر".',
    calib_now_glance: 'أخيراً: أبقِ رأسك باتجاه الطريق…', calib_look_glance: 'حرّك عينيك فقط إلى الشاشة',
    calib_glance_hint: 'لا تحرّك رأسك. انظر للشاشة بعينيك فقط، كما يفعل من يختلس النظر للجوال.',
    calib_partial: 'المعايرة جزئية',
    calib_partial_hint: 'لم نتمكن من تمييز النظر بالعينين فقط. قرّب الجوال قليلاً أو اجعله أوضح أمام الكاميرا ثم أعد المحاولة، أو تابع بدون هذه الخطوة.',
    continue_anyway: 'متابعة على أي حال',
    min_speed_hint: 'تحت هذه السرعة لا تُسجَّل مخالفات (مثل الوقوف عند الإشارة أو الاصطفاف).', save: 'حفظ',
    driver_access: 'دخول السائقين', company_code: 'رمز الشركة', driver_link: 'رابط السائق',
    driver_access_hint: 'يدخل السائق من هذا الرابط برمز الشركة ورقم جواله والرمز السري الذي يظهر عند إضافته.',
    team: 'فريق الإشراف', add_supervisor: 'إضافة مشرف', min8: '8 أحرف على الأقل',

    platform_admin: 'إدارة المنصة', companies: 'الشركات', companies_sub: 'كل شركة لها حساب مشرف خاص وسائقون لا يراهم غيرها.',
    add_company: 'إضافة شركة', company: 'الشركة', alerts_30d: 'مخالفات 30 يوماً', no_companies: 'لا توجد شركات بعد',
    no_companies_hint: 'أضف أول شركة مع حساب المشرف الخاص بها.', company_name: 'اسم الشركة', company_ph: 'مثال: شركة النقل السريع',
    first_supervisor: 'حساب المشرف الأول', company_created: 'تم إنشاء الشركة. رمزها: {code}', remove: 'حذف', added: 'أُضيف',

    driver_login: 'دخول السائق', driver_login_sub: 'استخدم البيانات التي أرسلها لك المشرف.', hello: 'مرحباً',
    session_running: 'المراقبة جارية', session_running_hint: 'أعد فتح الكاميرا لمتابعة الجلسة.', resume: 'متابعة المراقبة',
    new_request: 'طلب مراقبة جديد', requested_by_x: 'من {name}', supervisor: 'المشرف', accept: 'قبول', decline: 'رفض',
    no_requests: 'لا توجد طلبات', no_requests_hint: 'عندما يرسل المشرف طلب مراقبة سيظهر هنا.', recent_sessions: 'آخر الجلسات',
    consent_title: 'قبل أن تبدأ', rule: 'القاعدة', rule_text: '{s} ث نظر · فوق {v} كم/س',
    consent_1: 'الكاميرا الأمامية تتابع اتجاه عينيك على الجوال فقط. التحليل يتم داخل جوالك.',
    consent_2: 'إذا نظرت إلى الشاشة لمدة متواصلة أثناء الحركة تُلتقط صورة وتُرسل للمشرف مع السرعة والموقع.',
    consent_3: 'يجب أن تبقى هذه الصفحة مفتوحة. الخروج منها أثناء الحركة يُسجَّل.',
    consent_4: 'تنتهي المراقبة تلقائياً بانتهاء المدة المطلوبة.',
    consent_agree: 'أوافق على المراقبة خلال هذه المدة فقط.', consent_start: 'موافق، جهّز الكاميرا',
    setup_title: 'تجهيز', opening_camera: 'جارٍ فتح الكاميرا…', loading_model: 'جارٍ تحميل نموذج تتبع العين…',
    calib_title: 'معايرة العين (9 ثوانٍ)', calib_mount: 'ثبّت الجوال في مكانه المعتاد في السيارة قبل البدء.',
    calib_get_ready: 'استعد…', calib_look_screen: 'انظر إلى الشاشة', calib_now_road: 'الآن انظر للأمام كأنك تقود…', calib_look_road: 'انظر إلى الطريق أمامك',
    calib_ok: 'تمت المعايرة', calib_failed: 'لم تنجح المعايرة',
    calib_failed_hint: 'النظر للشاشة والنظر للطريق يبدوان متشابهين من زاوية الكاميرا. حرّك الجوال قليلاً بحيث لا يكون أمام عينيك مباشرة، ثم أعد المحاولة.',
    try_again: 'إعادة المحاولة', start_watch: 'ابدأ المراقبة', face_not_found: 'الوجه غير ظاهر', face_hint: 'تأكد أن الكاميرا الأمامية ترى وجهك',
    err_https: 'الكاميرا تحتاج اتصالاً آمناً (https).', err_camera: 'لم نتمكن من فتح الكاميرا. اسمح بالوصول للكاميرا من إعدادات المتصفح ثم أعد المحاولة.',
    err_model: 'تعذر تحميل نموذج تتبع العين. تحقق من الإنترنت ثم أعد المحاولة.', err_location: 'اسمح بالوصول للموقع لحساب السرعة.',
    err_request_gone: 'هذا الطلب لم يعد متاحاً (انتهت صلاحيته أو ألغاه المشرف).',
    eyes_on_road: 'العين على الطريق', eyes_on_screen: 'انتبه للطريق', drive_safe: 'قيادة آمنة', look_at_road: 'انظر إلى الطريق',
    recorded: 'سُجّلت مخالفة', parked: 'السيارة متوقفة', parked_hint: 'لا يتم الرصد أثناء التوقف',
    cam_on: 'الكاميرا تعمل', test_mode_on: 'وضع التجربة: يتم الرصد حتى بدون حركة.',
    end_session: 'إنهاء المراقبة', end_confirm: 'إنهاء المراقبة قبل الوقت يُرسل تنبيهاً للمشرف. هل تريد الإنهاء؟',
    continue_watch: 'متابعة', end_now: 'إنهاء الآن',
    session_done: 'انتهت المراقبة', back_home: 'الرئيسية',
    done_completed: 'اكتملت المدة. عدد المخالفات: {n}', done_cancelled: 'أوقف المشرف المراقبة. عدد المخالفات: {n}', done_ended_early: 'أنهيت المراقبة قبل الوقت وتم إبلاغ المشرف.',

    u_sec: 'ث', u_min: 'د', u_hr: 'س', u_hour1: 'ساعة', u_hours: 'ساعات',
    just_now: 'الآن', ago_s: 'قبل {n} ث', ago_m: 'قبل {n} د', ago_h: 'قبل {n} س', close: 'إغلاق',

    err_error: 'حدث خطأ. حاول مرة أخرى.', err_network: 'لا يوجد اتصال بالخادم. تحقق من الإنترنت.',
    err_bad_credentials: 'بيانات الدخول غير صحيحة.', err_company_disabled: 'حساب الشركة معطّل.', err_missing_fields: 'أكمل الحقول المطلوبة.',
    err_weak_password: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.', err_email_taken: 'البريد مستخدم مسبقاً.', err_phone_taken: 'رقم الجوال مسجل لسائق آخر.',
    err_driver_busy: 'لدى هذا السائق طلب مفتوح أو جلسة جارية.', err_bad_duration: 'المدة يجب أن تكون بين 5 دقائق و12 ساعة.',
    err_not_found: 'العنصر غير موجود.', err_forbidden: 'لا تملك صلاحية لهذا الإجراء.', err_not_signed_in: 'انتهت الجلسة. سجّل الدخول مرة أخرى.',
    err_server_error: 'خطأ في الخادم. حاول لاحقاً.', err_bad_values: 'القيم غير صحيحة.'
  };

  const en = {
    hero_title: 'Eyes on the road, not on the screen',
    hero_sub: 'Salem detects when a driver is using their phone while driving by tracking the eyes, and sends the supervisor an instant photo with location and speed.',
    fact_1: 'A continuous look at the screen while moving is recorded as a violation, with a photo.',
    fact_2: 'Location and speed at the moment of the violation, on a map.',
    fact_3: 'Monitoring starts on the supervisor\'s request, for a set time, with the driver\'s consent.',
    staff_login: 'Supervisor sign in', email: 'Email', password: 'Password', sign_in: 'Sign in', sign_out: 'Sign out',
    are_you_driver: 'Are you a driver?', driver_hint: 'Open the driver page on your phone and sign in with your company code, phone number and PIN.', open_driver: 'Open driver page',

    nav_overview: 'Live monitoring', nav_alerts: 'Violations', nav_drivers: 'Drivers', nav_history: 'Request history', nav_settings: 'Settings',
    overview_sub: 'Drivers being monitored now, and requests waiting for the driver to accept.',
    send_request: 'Request monitoring', live_sessions: 'Current sessions', latest_alerts: 'Latest violations', view_all: 'View all',
    kpi_active: 'Being monitored', kpi_pending: 'Waiting for driver', kpi_gaze_today: 'Screen looks today', kpi_events_today: 'All alerts today', kpi_to_review: 'To review', kpi_drivers: 'Drivers',
    updated_at: 'Updated {t}',
    no_live: 'No one is being monitored right now', no_live_hint: 'Send a monitoring request to a driver. The session shows here as soon as they accept.',
    waiting_driver: 'Waiting for the driver to accept {d} of monitoring.', sent: 'Sent',
    speed: 'Speed', kmh: 'km/h', alerts: 'Violations', remaining: 'Remaining', last_signal: 'Last signal', map: 'Map', details: 'Details', stop: 'Stop',
    conn_lost: 'Connection lost', ds_watching: 'Monitoring', ds_calibrating: 'Setting up', ds_no_face: 'Face not visible', ds_away: 'Left the app', ds_parked: 'Stopped',
    confirm_stop_title: 'Stop monitoring?', confirm_stop_body: 'Monitoring will stop on the driver\'s phone right away.', back: 'Back', stopped: 'Stopped',

    alerts_sub: 'Every violation comes with a photo of the moment, the speed and the location. Review it, then confirm or dismiss.',
    all_types: 'All types', all_reviews: 'All statuses', all_drivers: 'All drivers',
    ev_gaze: 'Looked at screen', ev_left_screen: 'Left Salem', ev_face_lost: 'Face not visible', ev_ended_early: 'Ended monitoring early',
    rv_new: 'New', rv_confirmed: 'Confirmed', rv_dismissed: 'Dismissed',
    confirm: 'Confirm', dismiss: 'Dismiss', lasted: 'Lasted', reading_pattern: 'Reading/typing pattern', view_photo: 'View photo',
    no_events: 'No violations', no_events_hint: 'Violations detected during monitoring sessions will appear here.', no_events_session: 'No violations in this session yet.',
    driver: 'Driver', type: 'Type', time: 'Time', location: 'Location', eye_pattern: 'Eye movement', saccades: 'jumps', steady_look: 'Steady look',
    minutes_left: 'Minutes left', no_photo: 'No photo for this type', review_note: 'Review note', saved: 'Saved',

    drivers_sub: 'Add your drivers and send them their sign-in details. Scores cover the last 30 days.',
    add_driver: 'Add driver', score: 'Score', hours_watched: 'Hours monitored', last_session: 'Last session',
    reset_pin: 'New PIN', disable: 'Disable', enable: 'Enable', enabled: 'Enabled', disabled: 'Disabled',
    no_drivers: 'No drivers yet', no_drivers_hint: 'Add your first driver to send them a monitoring request.',
    full_name: 'Name', phone: 'Phone number', vehicle: 'Vehicle', vehicle_ph: 'e.g. Hilux — ABC 1234', add: 'Add', cancel: 'Cancel',
    driver_credentials: 'Driver sign-in details', cred_once: 'Save the PIN now. It will not be shown again. Send it to the driver.',
    pin: 'PIN', copy_message: 'Copy message', done: 'Done', copied: 'Copied',
    cred_message: 'Hi {name},\nTo sign in to Salem:\n{link}\nCompany code: {code}\nPhone: {phone}\nPIN: {pin}',
    add_driver_first: 'Add a driver first',
    watch_for: 'Monitoring time', custom: 'Other', minutes: 'Minutes', note_to_driver: 'Message to driver (optional)', note_ph: 'e.g. Riyadh — Qassim trip',
    test_mode: 'Test mode', test_mode_hint: 'Detects even when the car is not moving. For testing only.', test_mode_short: 'Test',
    send: 'Send', request_sent: 'Request sent to the driver',
    session_details: 'Session details', started: 'Started', ends: 'Ends',

    history_sub: 'Every monitoring request, its status and the number of violations in each session.', no_history: 'No requests yet',
    status: 'Status', duration: 'Duration', requested_by: 'Supervisor',
    st_pending: 'Waiting for driver', st_active: 'Running', st_completed: 'Completed', st_declined: 'Declined by driver', st_expired: 'Expired', st_cancelled: 'Stopped by supervisor', st_ended_early: 'Ended early by driver',

    detection_rules: 'Detection rules', gaze_seconds: 'Seconds looking at the screen before recording', min_speed: 'Lowest speed that counts as moving (km/h)',
    face_lost_seconds: 'Seconds the face can be hidden before recording',
    face_lost_hint: 'If the camera cannot see the driver\'s eyes for this long while moving (camera covered or phone turned away), a "Face not visible" violation is recorded.',
    calib_now_glance: 'Last step: keep your head facing the road…', calib_look_glance: 'Move only your eyes to the screen',
    calib_glance_hint: 'Do not turn your head. Look at the screen with your eyes only, the way someone sneaks a look at their phone.',
    calib_partial: 'Calibration partly done',
    calib_partial_hint: 'An eyes-only look could not be told apart from looking at the road. Move the phone a little closer or more in view of the camera and try again, or continue without this step.',
    continue_anyway: 'Continue anyway',
    min_speed_hint: 'Below this speed nothing is recorded (for example at a red light or when parked).', save: 'Save',
    driver_access: 'Driver sign-in', company_code: 'Company code', driver_link: 'Driver link',
    driver_access_hint: 'Drivers sign in at this link with the company code, their phone number and the PIN shown when you add them.',
    team: 'Supervisors', add_supervisor: 'Add supervisor', min8: 'At least 8 characters',

    platform_admin: 'Platform admin', companies: 'Companies', companies_sub: 'Each company has its own supervisor accounts and drivers that no one else can see.',
    add_company: 'Add company', company: 'Company', alerts_30d: 'Violations, 30 days', no_companies: 'No companies yet',
    no_companies_hint: 'Add the first company with its supervisor account.', company_name: 'Company name', company_ph: 'e.g. Fast Logistics Co.',
    first_supervisor: 'First supervisor account', company_created: 'Company created. Code: {code}', remove: 'Remove', added: 'Added',

    driver_login: 'Driver sign in', driver_login_sub: 'Use the details your supervisor sent you.', hello: 'Hello',
    session_running: 'Monitoring is running', session_running_hint: 'Turn the camera back on to continue the session.', resume: 'Continue monitoring',
    new_request: 'New monitoring request', requested_by_x: 'From {name}', supervisor: 'Supervisor', accept: 'Accept', decline: 'Decline',
    no_requests: 'No requests', no_requests_hint: 'When your supervisor sends a monitoring request it shows here.', recent_sessions: 'Recent sessions',
    consent_title: 'Before you start', rule: 'Rule', rule_text: '{s}s look · above {v} km/h',
    consent_1: 'The front camera follows where your eyes look on the phone. The analysis runs on your phone.',
    consent_2: 'If you keep looking at the screen while moving, a photo is taken and sent to your supervisor with the speed and location.',
    consent_3: 'Keep this page open. Leaving it while moving is recorded.',
    consent_4: 'Monitoring ends automatically when the requested time is up.',
    consent_agree: 'I agree to be monitored for this time only.', consent_start: 'Agree and set up camera',
    setup_title: 'Setup', opening_camera: 'Opening camera…', loading_model: 'Loading eye-tracking model…',
    calib_title: 'Eye calibration (9 seconds)', calib_mount: 'Put the phone in its usual mount in the car before you start.',
    calib_get_ready: 'Get ready…', calib_look_screen: 'Look at the screen', calib_now_road: 'Now look ahead as if driving…', calib_look_road: 'Look at the road ahead',
    calib_ok: 'Calibration done', calib_failed: 'Calibration did not work',
    calib_failed_hint: 'Looking at the screen and looking at the road look the same from the camera. Move the phone so it is not directly in front of your eyes, then try again.',
    try_again: 'Try again', start_watch: 'Start monitoring', face_not_found: 'Face not visible', face_hint: 'Make sure the front camera can see your face',
    err_https: 'The camera needs a secure connection (https).', err_camera: 'Could not open the camera. Allow camera access in your browser settings, then try again.',
    err_model: 'Could not load the eye-tracking model. Check your internet, then try again.', err_location: 'Allow location access so speed can be measured.',
    err_request_gone: 'This request is no longer available (it expired or the supervisor cancelled it).',
    eyes_on_road: 'Eyes on the road', eyes_on_screen: 'Watch the road', drive_safe: 'Drive safe', look_at_road: 'Look at the road',
    recorded: 'Violation recorded', parked: 'Car is stopped', parked_hint: 'Nothing is recorded while stopped',
    cam_on: 'Camera on', test_mode_on: 'Test mode: detecting even when not moving.',
    end_session: 'End monitoring', end_confirm: 'Ending monitoring early notifies your supervisor. End now?',
    continue_watch: 'Keep going', end_now: 'End now',
    session_done: 'Monitoring finished', back_home: 'Home',
    done_completed: 'Time is up. Violations: {n}', done_cancelled: 'Your supervisor stopped monitoring. Violations: {n}', done_ended_early: 'You ended monitoring early and your supervisor was notified.',

    u_sec: 's', u_min: 'min', u_hr: 'h', u_hour1: 'hour', u_hours: 'hours',
    just_now: 'just now', ago_s: '{n}s ago', ago_m: '{n} min ago', ago_h: '{n} h ago', close: 'Close',

    err_error: 'Something went wrong. Try again.', err_network: 'Cannot reach the server. Check your internet.',
    err_bad_credentials: 'Sign-in details are not correct.', err_company_disabled: 'This company account is disabled.', err_missing_fields: 'Fill in the required fields.',
    err_weak_password: 'Password must be at least 8 characters.', err_email_taken: 'This email is already used.', err_phone_taken: 'This phone number belongs to another driver.',
    err_driver_busy: 'This driver already has an open request or a running session.', err_bad_duration: 'Duration must be between 5 minutes and 12 hours.',
    err_not_found: 'Not found.', err_forbidden: 'You do not have permission for this.', err_not_signed_in: 'Your session ended. Sign in again.',
    err_server_error: 'Server error. Try again later.', err_bad_values: 'The values are not valid.'
  };

  const dict = { ar, en };
  let lang = 'ar';
  try { lang = localStorage.getItem('salem_lang') || 'ar'; } catch (_) {}
  if (!dict[lang]) lang = 'ar';
  S.lang = lang;

  S.t = function (key, vars) {
    let s = (dict[S.lang] && dict[S.lang][key]) ?? dict.ar[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
    return s;
  };

  S.applyI18n = function () {
    const root = document.documentElement;
    root.lang = S.lang;
    root.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = S.t(el.dataset.i18n); });
    document.querySelectorAll('[data-lang-toggle]').forEach(el => {
      el.textContent = S.lang === 'ar' ? 'English' : 'العربية';
      el.onclick = () => S.setLang(S.lang === 'ar' ? 'en' : 'ar');
    });
    document.querySelectorAll('[data-icon]').forEach(el => {
      if (!el.dataset.iconDone && S.icons && S.icons[el.dataset.icon]) { el.innerHTML = S.icons[el.dataset.icon]; el.dataset.iconDone = '1'; }
    });
  };

  S.setLang = function (l) {
    S.lang = l;
    try { localStorage.setItem('salem_lang', l); } catch (_) {}
    S.applyI18n();
    if (typeof S.onLangChange === 'function') S.onLangChange();
  };
})();
