import axios from 'axios';

const SUPPORTED_LANGS = new Set(['bn', 'en', 'es', 'hi', 'id', 'ur', 'tr', 'fr', 'ru', 'ar', 'ml']);
const translationCache = new Map();

const EXACT_TRANSLATIONS = {
  bn: {
    'This command only works in groups.': 'এই কমান্ডটি শুধু গ্রুপে কাজ করে।',
    'Please wait before using this command again.': 'এই কমান্ডটি আবার ব্যবহার করার আগে অনুগ্রহ করে অপেক্ষা করুন।',
    'An error occurred while executing the command.': 'কমান্ড চালানোর সময় একটি ত্রুটি ঘটেছে।',
    'Your download is still in progress, please be patience.': 'আপনার ডাউনলোড এখনও চলছে, অনুগ্রহ করে ধৈর্য ধরুন।',
    'Another YouTube download is in progress. Your request is queued.': 'আরেকটি YouTube ডাউনলোড চলছে। আপনার অনুরোধ সারিতে রাখা হয়েছে।',
    'Another YouTube download is in progress. Your selection is queued.': 'আরেকটি YouTube ডাউনলোড চলছে। আপনার নির্বাচন সারিতে রাখা হয়েছে।',
    'Select video quality by replying with the number:': 'ভিডিওর মান নির্বাচন করতে নম্বর দিয়ে উত্তর দিন:',
    'Select quality by replying with the number:': 'মান নির্বাচন করতে নম্বর দিয়ে উত্তর দিন:',
    'Search failed. Please try again later.': 'অনুসন্ধান ব্যর্থ হয়েছে। পরে আবার চেষ্টা করুন।',
    'An error occurred while processing the video': 'ভিডিও প্রক্রিয়াকরণের সময় একটি ত্রুটি ঘটেছে',
    'An error occurred while processing the audio': 'অডিও প্রক্রিয়াকরণের সময় একটি ত্রুটি ঘটেছে',
    'An error occurred while searching': 'অনুসন্ধানের সময় একটি ত্রুটি ঘটেছে',
    'Please provide a valid YouTube URL': 'অনুগ্রহ করে একটি বৈধ YouTube URL দিন।',
    'No videos found for your search': 'আপনার অনুসন্ধানের জন্য কোনো ভিডিও পাওয়া যায়নি।',
    'Failed to download all available qualities.': 'উপলব্ধ সব মান ডাউনলোড করা যায়নি।',
    'Failed to download selected quality.': 'নির্বাচিত মান ডাউনলোড করা যায়নি।',
    'Failed to download selected media.': 'নির্বাচিত মিডিয়া ডাউনলোড করা যায়নি।',
    'YouTube video': 'YouTube ভিডিও',
    'Facebook video': 'Facebook ভিডিও',
    'TikTok video': 'TikTok ভিডিও',
    'Twitter video': 'Twitter ভিডিও',
    'Pinterest video': 'Pinterest ভিডিও',
    'Quote created.': 'কোট তৈরি হয়েছে।'
  },
  es: {
    'This command only works in groups.': 'Este comando solo funciona en grupos.',
    'Please wait before using this command again.': 'Espera antes de usar este comando de nuevo.',
    'An error occurred while executing the command.': 'Ocurrió un error al ejecutar el comando.',
    'Your download is still in progress, please be patience.': 'Tu descarga sigue en progreso, por favor ten paciencia.',
    'Another YouTube download is in progress. Your request is queued.': 'Hay otra descarga de YouTube en progreso. Tu solicitud está en cola.',
    'Another YouTube download is in progress. Your selection is queued.': 'Hay otra descarga de YouTube en progreso. Tu selección está en cola.',
    'Select video quality by replying with the number:': 'Selecciona la calidad del video respondiendo con el número:',
    'Select quality by replying with the number:': 'Selecciona la calidad respondiendo con el número:',
    'Search failed. Please try again later.': 'La búsqueda falló. Inténtalo de nuevo más tarde.',
    'An error occurred while processing the video': 'Ocurrió un error al procesar el video',
    'An error occurred while processing the audio': 'Ocurrió un error al procesar el audio',
    'An error occurred while searching': 'Ocurrió un error durante la búsqueda',
    'Please provide a valid YouTube URL': 'Proporciona una URL válida de YouTube.',
    'No videos found for your search': 'No se encontraron videos para tu búsqueda.',
    'Failed to download all available qualities.': 'No se pudieron descargar todas las calidades disponibles.',
    'Failed to download selected quality.': 'No se pudo descargar la calidad seleccionada.',
    'Failed to download selected media.': 'No se pudo descargar el medio seleccionado.',
    'YouTube video': 'Video de YouTube',
    'Facebook video': 'Video de Facebook',
    'TikTok video': 'Video de TikTok',
    'Twitter video': 'Video de Twitter',
    'Pinterest video': 'Video de Pinterest',
    'Quote created.': 'Cita creada.'
  },
  hi: {
    'This command only works in groups.': 'यह कमांड केवल ग्रुप में काम करता है।',
    'Please wait before using this command again.': 'इस कमांड को फिर से उपयोग करने से पहले कृपया प्रतीक्षा करें।',
    'An error occurred while executing the command.': 'कमांड चलाते समय एक त्रुटि हुई।',
    'Your download is still in progress, please be patience.': 'आपका डाउनलोड अभी भी जारी है, कृपया धैर्य रखें।',
    'Another YouTube download is in progress. Your request is queued.': 'एक और YouTube डाउनलोड चल रहा है। आपका अनुरोध कतार में है।',
    'Another YouTube download is in progress. Your selection is queued.': 'एक और YouTube डाउनलोड चल रहा है। आपका चयन कतार में है।',
    'Select video quality by replying with the number:': 'वीडियो गुणवत्ता चुनने के लिए नंबर से जवाब दें:',
    'Select quality by replying with the number:': 'गुणवत्ता चुनने के लिए नंबर से जवाब दें:',
    'Search failed. Please try again later.': 'खोज विफल हुई। कृपया बाद में फिर प्रयास करें।',
    'An error occurred while processing the video': 'वीडियो प्रोसेस करते समय एक त्रुटि हुई',
    'An error occurred while processing the audio': 'ऑडियो प्रोसेस करते समय एक त्रुटि हुई',
    'An error occurred while searching': 'खोज के दौरान एक त्रुटि हुई',
    'Please provide a valid YouTube URL': 'कृपया एक सही YouTube URL दें।',
    'No videos found for your search': 'आपकी खोज के लिए कोई वीडियो नहीं मिला।',
    'Failed to download all available qualities.': 'सभी उपलब्ध क्वालिटी डाउनलोड नहीं हो सकीं।',
    'Failed to download selected quality.': 'चुनी गई क्वालिटी डाउनलोड नहीं हो सकी।',
    'Failed to download selected media.': 'चुना गया मीडिया डाउनलोड नहीं हो सका।',
    'YouTube video': 'YouTube वीडियो',
    'Facebook video': 'Facebook वीडियो',
    'TikTok video': 'TikTok वीडियो',
    'Twitter video': 'Twitter वीडियो',
    'Pinterest video': 'Pinterest वीडियो',
    'Quote created.': 'उद्धरण बनाया गया।'
  },
  id: {
    'This command only works in groups.': 'Perintah ini hanya bekerja di grup.',
    'Please wait before using this command again.': 'Harap tunggu sebelum menggunakan perintah ini lagi.',
    'An error occurred while executing the command.': 'Terjadi kesalahan saat menjalankan perintah.',
    'Your download is still in progress, please be patience.': 'Unduhan Anda masih berlangsung, harap bersabar.',
    'Another YouTube download is in progress. Your request is queued.': 'Unduhan YouTube lain sedang berlangsung. Permintaan Anda masuk antrean.',
    'Another YouTube download is in progress. Your selection is queued.': 'Unduhan YouTube lain sedang berlangsung. Pilihan Anda masuk antrean.',
    'Select video quality by replying with the number:': 'Pilih kualitas video dengan membalas nomor:',
    'Select quality by replying with the number:': 'Pilih kualitas dengan membalas nomor:',
    'Search failed. Please try again later.': 'Pencarian gagal. Silakan coba lagi nanti.',
    'An error occurred while processing the video': 'Terjadi kesalahan saat memproses video',
    'An error occurred while processing the audio': 'Terjadi kesalahan saat memproses audio',
    'An error occurred while searching': 'Terjadi kesalahan saat mencari',
    'Please provide a valid YouTube URL': 'Harap berikan URL YouTube yang valid.',
    'No videos found for your search': 'Tidak ada video yang ditemukan untuk pencarian Anda.',
    'Failed to download all available qualities.': 'Gagal mengunduh semua kualitas yang tersedia.',
    'Failed to download selected quality.': 'Gagal mengunduh kualitas yang dipilih.',
    'Failed to download selected media.': 'Gagal mengunduh media yang dipilih.',
    'YouTube video': 'Video YouTube',
    'Facebook video': 'Video Facebook',
    'TikTok video': 'Video TikTok',
    'Twitter video': 'Video Twitter',
    'Pinterest video': 'Video Pinterest',
    'Quote created.': 'Kutipan dibuat.'
  },
  ur: {
    'This command only works in groups.': 'یہ کمانڈ صرف گروپ میں کام کرتی ہے۔',
    'Please wait before using this command again.': 'اس کمانڈ کو دوبارہ استعمال کرنے سے پہلے براہ کرم انتظار کریں۔',
    'An error occurred while executing the command.': 'کمانڈ چلاتے وقت ایک خرابی پیش آئی۔',
    'Your download is still in progress, please be patience.': 'آپ کی ڈاؤن لوڈ ابھی جاری ہے، براہ کرم صبر کریں۔',
    'Another YouTube download is in progress. Your request is queued.': 'ایک اور YouTube ڈاؤن لوڈ جاری ہے۔ آپ کی درخواست قطار میں ہے۔',
    'Another YouTube download is in progress. Your selection is queued.': 'ایک اور YouTube ڈاؤن لوڈ جاری ہے۔ آپ کا انتخاب قطار میں ہے۔',
    'Select video quality by replying with the number:': 'ویڈیو کوالٹی منتخب کرنے کے لیے نمبر کے ساتھ جواب دیں:',
    'Select quality by replying with the number:': 'کوالٹی منتخب کرنے کے لیے نمبر کے ساتھ جواب دیں:',
    'Search failed. Please try again later.': 'تلاش ناکام ہوگئی۔ براہ کرم بعد میں دوبارہ کوشش کریں۔',
    'An error occurred while processing the video': 'ویڈیو پروسیس کرتے وقت ایک خرابی پیش آئی',
    'An error occurred while processing the audio': 'آڈیو پروسیس کرتے وقت ایک خرابی پیش آئی',
    'An error occurred while searching': 'تلاش کے دوران ایک خرابی پیش آئی',
    'Please provide a valid YouTube URL': 'براہ کرم درست YouTube URL فراہم کریں۔',
    'No videos found for your search': 'آپ کی تلاش کے لیے کوئی ویڈیو نہیں ملا۔',
    'Failed to download all available qualities.': 'تمام دستیاب کوالٹیز ڈاؤن لوڈ نہیں ہو سکیں۔',
    'Failed to download selected quality.': 'منتخب کردہ کوالٹی ڈاؤن لوڈ نہیں ہو سکی۔',
    'Failed to download selected media.': 'منتخب کردہ میڈیا ڈاؤن لوڈ نہیں ہو سکا۔',
    'YouTube video': 'YouTube ویڈیو',
    'Facebook video': 'Facebook ویڈیو',
    'TikTok video': 'TikTok ویڈیو',
    'Twitter video': 'Twitter ویڈیو',
    'Pinterest video': 'Pinterest ویڈیو',
    'Quote created.': 'اقتباس تیار ہوگیا۔'
  },
  tr: {
    'This command only works in groups.': 'Bu komut sadece gruplarda çalışır.',
    'Please wait before using this command again.': 'Bu komutu tekrar kullanmadan önce lütfen bekleyin.',
    'An error occurred while executing the command.': 'Komut çalıştırılırken bir hata oluştu.',
    'Your download is still in progress, please be patience.': 'İndirmeniz hâlâ sürüyor, lütfen sabırlı olun.',
    'Another YouTube download is in progress. Your request is queued.': 'Başka bir YouTube indirmesi sürüyor. İsteğiniz sıraya alındı.',
    'Another YouTube download is in progress. Your selection is queued.': 'Başka bir YouTube indirmesi sürüyor. Seçiminiz sıraya alındı.',
    'Select video quality by replying with the number:': 'Video kalitesini seçmek için numarayla yanıt verin:',
    'Select quality by replying with the number:': 'Kaliteyi seçmek için numarayla yanıt verin:',
    'Search failed. Please try again later.': 'Arama başarısız oldu. Lütfen daha sonra tekrar deneyin.',
    'An error occurred while processing the video': 'Video işlenirken bir hata oluştu',
    'An error occurred while processing the audio': 'Ses işlenirken bir hata oluştu',
    'An error occurred while searching': 'Arama sırasında bir hata oluştu',
    'Please provide a valid YouTube URL': 'Lütfen geçerli bir YouTube URL’si girin.',
    'No videos found for your search': 'Aramanız için video bulunamadı.',
    'Failed to download all available qualities.': 'Mevcut tüm kaliteler indirilemedi.',
    'Failed to download selected quality.': 'Seçilen kalite indirilemedi.',
    'Failed to download selected media.': 'Seçilen medya indirilemedi.',
    'YouTube video': 'YouTube videosu',
    'Facebook video': 'Facebook videosu',
    'TikTok video': 'TikTok videosu',
    'Twitter video': 'Twitter videosu',
    'Pinterest video': 'Pinterest videosu',
    'Quote created.': 'Alıntı oluşturuldu.'
  },
  fr: {
    'This command only works in groups.': 'Cette commande fonctionne uniquement dans les groupes.',
    'Please wait before using this command again.': 'Veuillez attendre avant de réutiliser cette commande.',
    'An error occurred while executing the command.': 'Une erreur s’est produite lors de l’exécution de la commande.',
    'Your download is still in progress, please be patience.': 'Votre téléchargement est toujours en cours, veuillez patienter.',
    'Another YouTube download is in progress. Your request is queued.': 'Un autre téléchargement YouTube est en cours. Votre demande est en file d’attente.',
    'Another YouTube download is in progress. Your selection is queued.': 'Un autre téléchargement YouTube est en cours. Votre sélection est en file d’attente.',
    'Select video quality by replying with the number:': 'Sélectionnez la qualité vidéo en répondant avec le numéro :',
    'Select quality by replying with the number:': 'Sélectionnez la qualité en répondant avec le numéro :',
    'Search failed. Please try again later.': 'La recherche a échoué. Veuillez réessayer plus tard.',
    'An error occurred while processing the video': 'Une erreur s’est produite lors du traitement de la vidéo',
    'An error occurred while processing the audio': 'Une erreur s’est produite lors du traitement de l’audio',
    'An error occurred while searching': 'Une erreur s’est produite lors de la recherche',
    'Please provide a valid YouTube URL': 'Veuillez fournir une URL YouTube valide.',
    'No videos found for your search': 'Aucune vidéo trouvée pour votre recherche.',
    'Failed to download all available qualities.': 'Impossible de télécharger toutes les qualités disponibles.',
    'Failed to download selected quality.': 'Impossible de télécharger la qualité sélectionnée.',
    'Failed to download selected media.': 'Impossible de télécharger le média sélectionné.',
    'YouTube video': 'Vidéo YouTube',
    'Facebook video': 'Vidéo Facebook',
    'TikTok video': 'Vidéo TikTok',
    'Twitter video': 'Vidéo Twitter',
    'Pinterest video': 'Vidéo Pinterest',
    'Quote created.': 'Citation créée.'
  },
  ru: {
    'This command only works in groups.': 'Эта команда работает только в группах.',
    'Please wait before using this command again.': 'Пожалуйста, подождите перед повторным использованием этой команды.',
    'An error occurred while executing the command.': 'Произошла ошибка при выполнении команды.',
    'Your download is still in progress, please be patience.': 'Ваша загрузка всё ещё выполняется, пожалуйста, подождите.',
    'Another YouTube download is in progress. Your request is queued.': 'Идёт другая загрузка YouTube. Ваш запрос поставлен в очередь.',
    'Another YouTube download is in progress. Your selection is queued.': 'Идёт другая загрузка YouTube. Ваш выбор поставлен в очередь.',
    'Select video quality by replying with the number:': 'Выберите качество видео, ответив номером:',
    'Select quality by replying with the number:': 'Выберите качество, ответив номером:',
    'Search failed. Please try again later.': 'Поиск не удался. Пожалуйста, попробуйте позже.',
    'An error occurred while processing the video': 'Произошла ошибка при обработке видео',
    'An error occurred while processing the audio': 'Произошла ошибка при обработке аудио',
    'An error occurred while searching': 'Произошла ошибка при поиске',
    'Please provide a valid YouTube URL': 'Пожалуйста, укажите корректный URL YouTube.',
    'No videos found for your search': 'По вашему запросу видео не найдено.',
    'Failed to download all available qualities.': 'Не удалось скачать все доступные качества.',
    'Failed to download selected quality.': 'Не удалось скачать выбранное качество.',
    'Failed to download selected media.': 'Не удалось скачать выбранный медиафайл.',
    'YouTube video': 'Видео YouTube',
    'Facebook video': 'Видео Facebook',
    'TikTok video': 'Видео TikTok',
    'Twitter video': 'Видео Twitter',
    'Pinterest video': 'Видео Pinterest',
    'Quote created.': 'Цитата создана.'
  },
  ar: {
    'This command only works in groups.': 'هذا الأمر يعمل فقط في المجموعات.',
    'Please wait before using this command again.': 'يرجى الانتظار قبل استخدام هذا الأمر مرة أخرى.',
    'An error occurred while executing the command.': 'حدث خطأ أثناء تنفيذ الأمر.',
    'Your download is still in progress, please be patience.': 'ما زال التنزيل جارياً، يرجى التحلي بالصبر.',
    'Another YouTube download is in progress. Your request is queued.': 'هناك تنزيل آخر من YouTube قيد التنفيذ. تم وضع طلبك في الانتظار.',
    'Another YouTube download is in progress. Your selection is queued.': 'هناك تنزيل آخر من YouTube قيد التنفيذ. تم وضع اختيارك في الانتظار.',
    'Select video quality by replying with the number:': 'اختر جودة الفيديو بالرد بالرقم:',
    'Select quality by replying with the number:': 'اختر الجودة بالرد بالرقم:',
    'Search failed. Please try again later.': 'فشل البحث. يرجى المحاولة مرة أخرى لاحقاً.',
    'An error occurred while processing the video': 'حدث خطأ أثناء معالجة الفيديو',
    'An error occurred while processing the audio': 'حدث خطأ أثناء معالجة الصوت',
    'An error occurred while searching': 'حدث خطأ أثناء البحث',
    'Please provide a valid YouTube URL': 'يرجى تقديم رابط YouTube صالح.',
    'No videos found for your search': 'لم يتم العثور على أي فيديو لبحثك.',
    'Failed to download all available qualities.': 'فشل تنزيل كل الجودات المتاحة.',
    'Failed to download selected quality.': 'فشل تنزيل الجودة المحددة.',
    'Failed to download selected media.': 'فشل تنزيل الوسائط المحددة.',
    'YouTube video': 'فيديو YouTube',
    'Facebook video': 'فيديو Facebook',
    'TikTok video': 'فيديو TikTok',
    'Twitter video': 'فيديو Twitter',
    'Pinterest video': 'فيديو Pinterest',
    'Quote created.': 'تم إنشاء الاقتباس.'
  },
  ml: {
    'This command only works in groups.': 'ഈ കമാൻഡ് ഗ്രൂപ്പുകളിൽ മാത്രമേ പ്രവർത്തിക്കൂ.',
    'Please wait before using this command again.': 'ഈ കമാൻഡ് വീണ്ടും ഉപയോഗിക്കുന്നതിന് മുമ്പ് ദയവായി കാത്തിരിക്കുക.',
    'An error occurred while executing the command.': 'കമാൻഡ് പ്രവർത്തിപ്പിക്കുമ്പോൾ ഒരു പിശക് സംഭവിച്ചു.',
    'Your download is still in progress, please be patience.': 'നിങ്ങളുടെ ഡൗൺലോഡ് ഇപ്പോഴും പുരോഗമിക്കുകയാണ്, ദയവായി ക്ഷമയോടെ കാത്തിരിക്കുക.',
    'Another YouTube download is in progress. Your request is queued.': 'മറ്റൊരു YouTube ഡൗൺലോഡ് നടക്കുകയാണ്. നിങ്ങളുടെ അഭ്യർത്ഥന ക്യൂവിൽ ചേർത്തിരിക്കുന്നു.',
    'Another YouTube download is in progress. Your selection is queued.': 'മറ്റൊരു YouTube ഡൗൺലോഡ് നടക്കുകയാണ്. നിങ്ങളുടെ തിരഞ്ഞെടുപ്പ് ക്യൂവിൽ ചേർത്തിരിക്കുന്നു.',
    'Select video quality by replying with the number:': 'വീഡിയോ ഗുണമേന്മ തിരഞ്ഞെടുക്കാൻ നമ്പർ നൽകി മറുപടി നൽകുക:',
    'Select quality by replying with the number:': 'ഗുണമേന്മ തിരഞ്ഞെടുക്കാൻ നമ്പർ നൽകി മറുപടി നൽകുക:',
    'Search failed. Please try again later.': 'തിരച്ചിൽ പരാജയപ്പെട്ടു. ദയവായി പിന്നീട് വീണ്ടും ശ്രമിക്കുക.',
    'An error occurred while processing the video': 'വീഡിയോ പ്രോസസ് ചെയ്യുന്നതിനിടെ ഒരു പിശക് സംഭവിച്ചു',
    'An error occurred while processing the audio': 'ഓഡിയോ പ്രോസസ് ചെയ്യുന്നതിനിടെ ഒരു പിശക് സംഭവിച്ചു',
    'An error occurred while searching': 'തിരയുന്നതിനിടെ ഒരു പിശക് സംഭവിച്ചു',
    'Please provide a valid YouTube URL': 'ദയവായി ശരിയായ YouTube URL നൽകുക.',
    'No videos found for your search': 'നിങ്ങളുടെ തിരച്ചിലിന് വീഡിയോ ഒന്നും കണ്ടെത്തിയില്ല.',
    'Failed to download all available qualities.': 'ലഭ്യമായ എല്ലാ ഗുണമേന്മകളും ഡൗൺലോഡ് ചെയ്യാൻ കഴിഞ്ഞില്ല.',
    'Failed to download selected quality.': 'തിരഞ്ഞെടുത്ത ഗുണമേന്മ ഡൗൺലോഡ് ചെയ്യാൻ കഴിഞ്ഞില്ല.',
    'Failed to download selected media.': 'തിരഞ്ഞെടുത്ത മീഡിയ ഡൗൺലോഡ് ചെയ്യാൻ കഴിഞ്ഞില്ല.',
    'YouTube video': 'YouTube വീഡിയോ',
    'Facebook video': 'Facebook വീഡിയോ',
    'TikTok video': 'TikTok വീഡിയോ',
    'Twitter video': 'Twitter വീഡിയോ',
    'Pinterest video': 'Pinterest വീഡിയോ',
    'Quote created.': 'ക്വോട്ട് സൃഷ്ടിച്ചു.'
  }
};

const PREFIX_TRANSLATIONS = {
  bn: {
    'Usage: ': 'ব্যবহার: ',
    'Please provide ': 'অনুগ্রহ করে দিন ',
    'Please reply to ': 'অনুগ্রহ করে উত্তর দিন ',
    'Reply to ': 'উত্তর দিন ',
    'Failed to ': 'ব্যর্থ হয়েছে ',
    'An error occurred while processing ': 'প্রক্রিয়াকরণের সময় একটি ত্রুটি ঘটেছে ',
    'Download failed. ': 'ডাউনলোড ব্যর্থ হয়েছে। ',
    'Invalid ': 'অবৈধ '
  },
  es: {
    'Usage: ': 'Uso: ',
    'Please provide ': 'Por favor proporciona ',
    'Please reply to ': 'Por favor responde a ',
    'Reply to ': 'Responde a ',
    'Failed to ': 'No se pudo ',
    'An error occurred while processing ': 'Ocurrió un error al procesar ',
    'Download failed. ': 'La descarga falló. ',
    'Invalid ': 'Inválido '
  },
  hi: {
    'Usage: ': 'उपयोग: ',
    'Please provide ': 'कृपया दें ',
    'Please reply to ': 'कृपया उत्तर दें ',
    'Reply to ': 'उत्तर दें ',
    'Failed to ': 'विफल रहा ',
    'An error occurred while processing ': 'प्रोसेस करते समय एक त्रुटि हुई ',
    'Download failed. ': 'डाउनलोड विफल हुआ। ',
    'Invalid ': 'अमान्य '
  },
  id: {
    'Usage: ': 'Penggunaan: ',
    'Please provide ': 'Harap berikan ',
    'Please reply to ': 'Harap balas ke ',
    'Reply to ': 'Balas ke ',
    'Failed to ': 'Gagal untuk ',
    'An error occurred while processing ': 'Terjadi kesalahan saat memproses ',
    'Download failed. ': 'Unduhan gagal. ',
    'Invalid ': 'Tidak valid '
  },
  ur: {
    'Usage: ': 'استعمال: ',
    'Please provide ': 'براہ کرم فراہم کریں ',
    'Please reply to ': 'براہ کرم جواب دیں ',
    'Reply to ': 'جواب دیں ',
    'Failed to ': 'ناکام رہا ',
    'An error occurred while processing ': 'پروسیس کرتے وقت ایک خرابی پیش آئی ',
    'Download failed. ': 'ڈاؤن لوڈ ناکام ہوگیا۔ ',
    'Invalid ': 'غلط '
  },
  tr: {
    'Usage: ': 'Kullanım: ',
    'Please provide ': 'Lütfen sağlayın ',
    'Please reply to ': 'Lütfen şuna yanıt verin ',
    'Reply to ': 'Şuna yanıt verin ',
    'Failed to ': 'Başarısız oldu: ',
    'An error occurred while processing ': 'İşlenirken bir hata oluştu ',
    'Download failed. ': 'İndirme başarısız oldu. ',
    'Invalid ': 'Geçersiz '
  },
  fr: {
    'Usage: ': 'Utilisation : ',
    'Please provide ': 'Veuillez fournir ',
    'Please reply to ': 'Veuillez répondre à ',
    'Reply to ': 'Répondez à ',
    'Failed to ': 'Échec de ',
    'An error occurred while processing ': 'Une erreur s’est produite lors du traitement de ',
    'Download failed. ': 'Le téléchargement a échoué. ',
    'Invalid ': 'Invalide '
  },
  ru: {
    'Usage: ': 'Использование: ',
    'Please provide ': 'Пожалуйста, укажите ',
    'Please reply to ': 'Пожалуйста, ответьте на ',
    'Reply to ': 'Ответьте на ',
    'Failed to ': 'Не удалось ',
    'An error occurred while processing ': 'Произошла ошибка при обработке ',
    'Download failed. ': 'Загрузка не удалась. ',
    'Invalid ': 'Неверный '
  },
  ar: {
    'Usage: ': 'الاستخدام: ',
    'Please provide ': 'يرجى تقديم ',
    'Please reply to ': 'يرجى الرد على ',
    'Reply to ': 'قم بالرد على ',
    'Failed to ': 'فشل في ',
    'An error occurred while processing ': 'حدث خطأ أثناء معالجة ',
    'Download failed. ': 'فشل التنزيل. ',
    'Invalid ': 'غير صالح '
  },
  ml: {
    'Usage: ': 'ഉപയോഗം: ',
    'Please provide ': 'ദയവായി നൽകുക ',
    'Please reply to ': 'ദയവായി മറുപടി നൽകുക ',
    'Reply to ': 'മറുപടി നൽകുക ',
    'Failed to ': 'പരാജയപ്പെട്ടു ',
    'An error occurred while processing ': 'പ്രോസസ് ചെയ്യുന്നതിനിടെ ഒരു പിശക് സംഭവിച്ചു ',
    'Download failed. ': 'ഡൗൺലോഡ് പരാജയപ്പെട്ടു. ',
    'Invalid ': 'അസാധുവായ '
  }
};

export function normalizeBotLang(lang) {
  const normalized = String(lang || 'en').trim().toLowerCase();
  return SUPPORTED_LANGS.has(normalized) ? normalized : 'en';
}

export function getBotLang() {
  return normalizeBotLang(process.env.BOT_LANG || 'en');
}

function translateExact(text, lang) {
  return EXACT_TRANSLATIONS[lang]?.[text] || null;
}

function translatePrefixes(text, lang) {
  const dictionary = PREFIX_TRANSLATIONS[lang];
  if (!dictionary) return text;

  let translated = text;
  for (const [source, target] of Object.entries(dictionary).sort((a, b) => b[0].length - a[0].length)) {
    if (translated.startsWith(source)) {
      translated = `${target}${translated.slice(source.length)}`;
      break;
    }
  }

  return translated;
}

export function translateText(text, lang = getBotLang()) {
  if (typeof text !== 'string' || !text || lang === 'en') return text;

  const exact = translateExact(text, lang);
  if (exact) return exact;

  const lines = text.split('\n');
  const translatedLines = lines.map((line) => {
    const lineExact = translateExact(line, lang);
    if (lineExact) return lineExact;
    return translatePrefixes(line, lang);
  });

  return translatedLines.join('\n');
}

function protectSegments(text) {
  const tokens = [];
  let protectedText = text;
  const patterns = [
    /`[^`]+`/g,
    /https?:\/\/\S+/g,
    /@\d+/g
  ];

  for (const pattern of patterns) {
    protectedText = protectedText.replace(pattern, (match) => {
      const token = `__MARVIK_I18N_${tokens.length}__`;
      tokens.push({ token, value: match });
      return token;
    });
  }

  return { protectedText, tokens };
}

function restoreSegments(text, tokens) {
  let restored = text;
  for (const { token, value } of tokens) {
    restored = restored.replaceAll(token, value);
  }
  return restored;
}

async function translateWithRemote(text, lang) {
  const cacheKey = `${lang}::${text}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  const { protectedText, tokens } = protectSegments(text);

  try {
    const response = await axios.post(
      'https://translate.googleapis.com/translate_a/single',
      null,
      {
        params: {
          client: 'gtx',
          sl: 'auto',
          tl: lang,
          dt: 't',
          q: protectedText
        },
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }
    );

    const translated = Array.isArray(response.data?.[0])
      ? response.data[0].map((item) => item?.[0] || '').join('')
      : null;

    const finalText = translated
      ? restoreSegments(translated, tokens)
      : text;

    translationCache.set(cacheKey, finalText);
    return finalText;
  } catch {
    translationCache.set(cacheKey, text);
    return text;
  }
}

export async function translateTextAsync(text, lang = getBotLang()) {
  if (typeof text !== 'string' || !text || lang === 'en') return text;

  const exact = translateExact(text, lang);
  if (exact) return exact;

  const prefixed = translateText(text, lang);
  if (prefixed !== text) return prefixed;

  return translateWithRemote(text, lang);
}

export async function translateOutgoingPayload(payload, lang = getBotLang()) {
  if (!payload || typeof payload !== 'object' || lang === 'en') {
    return payload;
  }

  const nextPayload = { ...payload };

  if (typeof nextPayload.text === 'string') {
    nextPayload.text = await translateTextAsync(nextPayload.text, lang);
  }

  if (typeof nextPayload.caption === 'string') {
    nextPayload.caption = await translateTextAsync(nextPayload.caption, lang);
  }

  if (nextPayload.extendedTextMessage && typeof nextPayload.extendedTextMessage.text === 'string') {
    nextPayload.extendedTextMessage = {
      ...nextPayload.extendedTextMessage,
      text: await translateTextAsync(nextPayload.extendedTextMessage.text, lang)
    };
  }

  return nextPayload;
}

export function wrapClientSendMessage(client) {
  if (!client || client.__marvikI18nWrapped || typeof client.sendMessage !== 'function') {
    return client;
  }

  const originalSendMessage = client.sendMessage.bind(client);
  client.sendMessage = async (chatId, payload, options) => {
    const translatedPayload = await translateOutgoingPayload(payload, getBotLang());
    return originalSendMessage(chatId, translatedPayload, options);
  };
  client.__marvikI18nWrapped = true;
  return client;
}

export function getSupportedBotLanguages() {
  return [...SUPPORTED_LANGS];
}
