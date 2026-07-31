export default defineNuxtConfig({
  compatibilityDate: '2026-07-01',
  devtools: { enabled: false },
  app: {
    head: {
      title: 'Symbiont — живой паспорт проекта для Claude Code',
      htmlAttrs: { lang: 'ru' },
      script: [
        {
          innerHTML:
            "(function(){try{var t=localStorage.getItem('symbiont-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}})()",
        },
      ],
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'robots', content: 'noindex, nofollow' },
        {
          name: 'description',
          content:
            'Symbiont — концепт плагина для Claude Code: живой паспорт проекта, дирижёр контекста, машина принуждения, петля самообучения.',
        },
      ],
    },
  },
})
