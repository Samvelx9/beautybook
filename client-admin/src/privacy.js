// The platform's privacy policy, in each interface language. A standard
// policy, but written to match what the platform actually does: what it
// stores, who it shares with (hosting, Telegram, Lemon Squeezy), how long it
// keeps things (backups age out within 12 months). Change it here when that
// changes, and move each language's `updatedOn` forward — written out by hand
// because browsers don't all carry Armenian date formats.
//
// `{product}` is replaced with the product name. The contact section has two
// versions: with the support email the operator set, and without one.
export const PRIVACY = {
  en: {
    title: 'Privacy policy',
    updated: 'Last updated',
    updatedOn: '17 October 2026',
    back: '← Back',
    sections: [
      {
        heading: 'Who we are',
        body: [
          '{product} is an online booking service for beauty professionals ("masters"). Each master gets their own booking page where their clients choose a treatment and a time. This policy explains what personal data the service handles and how.',
          'For masters\' accounts, the operator of {product} ("we") decides how data is used. For the details clients enter when booking, the master whose page it is decides how that information is used; we store and process it on their behalf so the service can work.',
        ],
      },
      {
        heading: 'What we collect',
        body: [
          'From masters: name, email address, password (stored only as a secure hash), the content of their page (photo, about text, contacts, address, prices, opening hours), bookings, expenses they record, and — if they connect it — their Telegram chat so we can send notifications. We also keep the state of their trial or subscription.',
          'From clients: the name and phone number entered when booking, the chosen treatments and time, and — if they turn on reminders — a link to their Telegram chat.',
          'Payments are handled by Lemon Squeezy, our payment provider. We never see or store card details.',
        ],
      },
      {
        heading: 'How we use it',
        body: [
          'To run the service: showing booking pages, taking and managing bookings, sending booking notifications and reminders, handling subscriptions, keeping the service secure, and answering support requests.',
          'We do not sell personal data, use it for advertising, or show ads.',
        ],
      },
      {
        heading: 'Who we share it with',
        body: [
          'Only with the providers the service needs: our hosting provider (Oracle Cloud), Telegram (for messages a master or client has asked for), and Lemon Squeezy (for payments). Each receives only what its part of the service requires.',
          'A client\'s booking details are visible to the master they booked with. We may also disclose data where the law requires it.',
        ],
      },
      {
        heading: 'How long we keep it',
        body: [
          'For as long as a master\'s account exists. A master can delete their account at any time in Settings, which permanently deletes their page, price list, bookings and expenses. Backup copies are overwritten on a rolling schedule and are gone within 12 months.',
          'Clients who want their booking details removed can ask the master they booked with, or contact us.',
        ],
      },
      {
        heading: 'Cookies and storage',
        body: [
          'We do not use tracking or advertising cookies, and there are no analytics scripts. Your browser\'s local storage keeps your chosen language and, if you log in, your session.',
        ],
      },
      {
        heading: 'Security',
        body: [
          'All traffic is encrypted (HTTPS), passwords are stored only as secure hashes, and access to the servers is restricted. No system is perfectly secure, but we take reasonable measures to protect your data.',
        ],
      },
      {
        heading: 'Your rights',
        body: [
          'You can ask to see, correct or delete the personal data we hold about you, or object to how it is used. Masters can change most of their data themselves in their admin panel.',
        ],
      },
      {
        heading: 'Changes',
        body: [
          'If this policy changes, we will update it on this page and change the date above.',
        ],
      },
    ],
    contactHeading: 'Contact',
    contactWithEmail: 'For any privacy question or request, write to {email}.',
    contactWithoutEmail: 'For any privacy question or request, contact the operator of {product}. A contact address will be published here.',
  },

  ru: {
    title: 'Политика конфиденциальности',
    updated: 'Обновлено',
    updatedOn: '17 октября 2026 г.',
    back: '← Назад',
    sections: [
      {
        heading: 'Кто мы',
        body: [
          '{product} — сервис онлайн-записи для бьюти-мастеров. У каждого мастера своя страница записи, где клиенты выбирают процедуру и время. Эта политика объясняет, какие персональные данные обрабатывает сервис и как.',
          'Данными аккаунтов мастеров распоряжается оператор {product} («мы»). Данными, которые клиенты вводят при записи, распоряжается мастер, чья это страница; мы храним и обрабатываем их по его поручению, чтобы сервис работал.',
        ],
      },
      {
        heading: 'Что мы собираем',
        body: [
          'О мастерах: имя, адрес электронной почты, пароль (хранится только в виде защищённого хеша), содержимое страницы (фото, текст о себе, контакты, адрес, цены, часы работы), записи, внесённые расходы и — если мастер его подключил — чат в Telegram для уведомлений. Также мы храним состояние пробного периода или подписки.',
          'О клиентах: имя и номер телефона, указанные при записи, выбранные процедуры и время и — если клиент включил напоминания — привязку к его чату в Telegram.',
          'Платежи обрабатывает наш платёжный провайдер Lemon Squeezy. Данные карт мы не видим и не храним.',
        ],
      },
      {
        heading: 'Как мы их используем',
        body: [
          'Чтобы сервис работал: показывать страницы записи, принимать записи и управлять ими, отправлять уведомления и напоминания, вести подписки, обеспечивать безопасность и отвечать на обращения.',
          'Мы не продаём персональные данные, не используем их для рекламы и не показываем рекламу.',
        ],
      },
      {
        heading: 'Кому мы их передаём',
        body: [
          'Только поставщикам, без которых сервис не работает: хостинг-провайдеру (Oracle Cloud), Telegram (для сообщений, которые запросил мастер или клиент) и Lemon Squeezy (для платежей). Каждый получает только то, что нужно для его части работы.',
          'Данные записи клиента видит мастер, к которому он записался. Мы также можем раскрыть данные, если этого требует закон.',
        ],
      },
      {
        heading: 'Как долго мы их храним',
        body: [
          'Пока существует аккаунт мастера. Мастер может в любой момент удалить аккаунт в Настройках — это навсегда удаляет страницу, прайс, записи и расходы. Резервные копии перезаписываются по графику и полностью исчезают в течение 12 месяцев.',
          'Клиент, который хочет удалить свои данные записи, может обратиться к мастеру, у которого записывался, или к нам.',
        ],
      },
      {
        heading: 'Cookie и хранилище браузера',
        body: [
          'Мы не используем отслеживающие и рекламные cookie, на сайте нет аналитики. В локальном хранилище браузера сохраняются выбранный язык и, если вы вошли в аккаунт, ваша сессия.',
        ],
      },
      {
        heading: 'Безопасность',
        body: [
          'Весь трафик шифруется (HTTPS), пароли хранятся только в виде защищённых хешей, доступ к серверам ограничен. Абсолютно защищённых систем не бывает, но мы принимаем разумные меры для защиты ваших данных.',
        ],
      },
      {
        heading: 'Ваши права',
        body: [
          'Вы можете запросить доступ к своим персональным данным, их исправление или удаление, а также возразить против их использования. Большую часть своих данных мастера могут изменить сами в панели управления.',
        ],
      },
      {
        heading: 'Изменения',
        body: [
          'Если политика изменится, мы обновим её на этой странице и поменяем дату выше.',
        ],
      },
    ],
    contactHeading: 'Контакты',
    contactWithEmail: 'С любыми вопросами и запросами о персональных данных пишите на {email}.',
    contactWithoutEmail: 'С любыми вопросами и запросами о персональных данных обращайтесь к оператору {product}. Адрес для связи будет опубликован здесь.',
  },

  hy: {
    title: 'Գաղտնիության քաղաքականություն',
    updated: 'Թարմացվել է',
    updatedOn: '2026 թ. հոկտեմբերի 17',
    back: '← Հետ',
    sections: [
      {
        heading: 'Ովքեր ենք մենք',
        body: [
          '{product}-ը առցանց գրանցման ծառայություն է գեղեցկության վարպետների համար։ Յուրաքանչյուր վարպետ ունի իր գրանցման էջը, որտեղ հաճախորդներն ընտրում են պրոցեդուրան և ժամը։ Այս քաղաքականությունը բացատրում է, թե ինչ անձնական տվյալներ է մշակում ծառայությունը և ինչպես։',
          'Վարպետների հաշիվների տվյալների օգտագործման մասին որոշում է {product}-ի օպերատորը («մենք»)։ Հաճախորդների՝ գրանցվելիս մուտքագրած տվյալների մասին որոշում է այն վարպետը, ում էջն է դա. մենք դրանք պահում և մշակում ենք նրա անունից, որպեսզի ծառայությունն աշխատի։',
        ],
      },
      {
        heading: 'Ինչ ենք հավաքում',
        body: [
          'Վարպետներից՝ անուն, էլ. հասցե, գաղտնաբառ (պահվում է միայն անվտանգ հեշի տեսքով), էջի բովանդակությունը (լուսանկար, ներկայացում, կոնտակտներ, հասցե, գներ, աշխատանքային ժամեր), գրանցումներ, գրանցված ծախսեր և, եթե միացրել են, Telegram-ի չաթը՝ ծանուցումների համար։ Պահում ենք նաև փորձաշրջանի կամ բաժանորդագրության վիճակը։',
          'Հաճախորդներից՝ գրանցվելիս նշված անունն ու հեռախոսահամարը, ընտրված պրոցեդուրաներն ու ժամը և, եթե միացրել են հիշեցումները, կապը նրանց Telegram-ի չաթի հետ։',
          'Վճարումները մշակում է մեր վճարային մատակարարը՝ Lemon Squeezy-ն։ Քարտի տվյալները մենք չենք տեսնում և չենք պահում։',
        ],
      },
      {
        heading: 'Ինչպես ենք օգտագործում',
        body: [
          'Ծառայության աշխատանքի համար՝ գրանցման էջերը ցուցադրելու, գրանցումներ ընդունելու և կառավարելու, ծանուցումներ և հիշեցումներ ուղարկելու, բաժանորդագրությունները վարելու, անվտանգությունն ապահովելու և հարցումներին պատասխանելու համար։',
          'Մենք չենք վաճառում անձնական տվյալներ, չենք օգտագործում դրանք գովազդի համար և գովազդ չենք ցուցադրում։',
        ],
      },
      {
        heading: 'Ում հետ ենք կիսվում',
        body: [
          'Միայն այն մատակարարների հետ, առանց որոնց ծառայությունը չի աշխատի՝ հոսթինգի մատակարար (Oracle Cloud), Telegram (վարպետի կամ հաճախորդի խնդրած հաղորդագրությունների համար) և Lemon Squeezy (վճարումների համար)։ Յուրաքանչյուրը ստանում է միայն այն, ինչ անհրաժեշտ է իր մասի համար։',
          'Հաճախորդի գրանցման տվյալները տեսնում է այն վարպետը, ում մոտ նա գրանցվել է։ Կարող ենք տվյալներ բացահայտել նաև օրենքով պահանջվող դեպքերում։',
        ],
      },
      {
        heading: 'Որքան ժամանակ ենք պահում',
        body: [
          'Քանի դեռ վարպետի հաշիվը գոյություն ունի։ Վարպետը ցանկացած պահի կարող է ջնջել հաշիվը Կարգավորումներում, ինչը ընդմիշտ ջնջում է էջը, գնացուցակը, գրանցումներն ու ծախսերը։ Պահուստային պատճենները վերագրվում են ըստ ժամանակացույցի և ամբողջությամբ վերանում են 12 ամսվա ընթացքում։',
          'Հաճախորդը, որը ցանկանում է ջնջել իր գրանցման տվյալները, կարող է դիմել այն վարպետին, ում մոտ գրանցվել է, կամ մեզ։',
        ],
      },
      {
        heading: 'Cookie-ներ և բրաուզերի պահոց',
        body: [
          'Մենք չենք օգտագործում հետևող կամ գովազդային cookie-ներ, կայքում անալիտիկա չկա։ Բրաուզերի տեղային պահոցում պահվում են ընտրված լեզուն և, եթե մուտք եք գործել, ձեր սեսիան։',
        ],
      },
      {
        heading: 'Անվտանգություն',
        body: [
          'Ամբողջ երթևեկությունը գաղտնագրված է (HTTPS), գաղտնաբառերը պահվում են միայն անվտանգ հեշերի տեսքով, սերվերների հասանելիությունը սահմանափակված է։ Բացարձակ անվտանգ համակարգեր չկան, բայց մենք ձեռնարկում ենք ողջամիտ միջոցներ ձեր տվյալները պաշտպանելու համար։',
        ],
      },
      {
        heading: 'Ձեր իրավունքները',
        body: [
          'Կարող եք խնդրել տեսնել, ուղղել կամ ջնջել ձեր մասին մեր պահած անձնական տվյալները կամ առարկել դրանց օգտագործմանը։ Վարպետները իրենց տվյալների մեծ մասը կարող են ինքնուրույն փոխել կառավարման վահանակում։',
        ],
      },
      {
        heading: 'Փոփոխություններ',
        body: [
          'Եթե քաղաքականությունը փոխվի, կթարմացնենք այն այս էջում և կփոխենք վերևի ամսաթիվը։',
        ],
      },
    ],
    contactHeading: 'Կապ',
    contactWithEmail: 'Գաղտնիության վերաբերյալ ցանկացած հարցով կամ հարցումով գրեք {email} հասցեին։',
    contactWithoutEmail: 'Գաղտնիության վերաբերյալ ցանկացած հարցով կամ հարցումով դիմեք {product}-ի օպերատորին։ Կապի հասցեն կհրապարակվի այստեղ։',
  },
};
