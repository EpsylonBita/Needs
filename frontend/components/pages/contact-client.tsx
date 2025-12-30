"use client";
import { useI18n } from "@/contexts/i18n-context";

export default function ContactClient() {
  const { t } = useI18n();
  return (
    <div className="container max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight mb-6 text-blue-600 dark:text-blue-400">{t('contact.title','Contact Us')}</h1>
      <div className="bg-card rounded-lg shadow-sm border p-6 mb-8">
        <p className="text-muted-foreground mb-6">
          {t("contact.intro","We'd love to hear from you! Please fill out the form below and we'll get back to you as soon as possible.")}
        </p>
        <form className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="firstName" className="text-sm font-medium">{t('contact.firstName','First Name')}</label>
              <input id="firstName" type="text" className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background" placeholder={t('contact.firstName.placeholder','Your first name')} />
            </div>
            <div className="space-y-2">
              <label htmlFor="lastName" className="text-sm font-medium">{t('contact.lastName','Last Name')}</label>
              <input id="lastName" type="text" className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background" placeholder={t('contact.lastName.placeholder','Your last name')} />
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">{t('auth.email','Email')}</label>
            <input id="email" type="email" className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background" placeholder={t('auth.email.placeholder','your.email@example.com')} />
          </div>
          <div className="space-y-2">
            <label htmlFor="subject" className="text-sm font-medium">{t('contact.subject','Subject')}</label>
            <input id="subject" type="text" className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background" placeholder={t('contact.subject.placeholder','What is this regarding?')} />
          </div>
          <div className="space-y-2">
            <label htmlFor="message" className="text-sm font-medium">{t('contact.message','Message')}</label>
            <textarea id="message" rows={5} className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background" placeholder={t('contact.message.placeholder','Your message here...')} />
          </div>
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors">
            {t('contact.send','Send Message')}
          </button>
        </form>
      </div>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div>
          <h2 className="text-xl font-semibold mb-4">{t('contact.office','Our Office')}</h2>
          <p className="text-muted-foreground mb-2">{t('contact.address.line1','123 Main Street')}</p>
          <p className="text-muted-foreground mb-2">{t('contact.address.line2','Suite 456')}</p>
          <p className="text-muted-foreground mb-2">{t('contact.address.city','San Francisco, CA 94105')}</p>
          <p className="text-muted-foreground">{t('contact.address.country','United States')}</p>
        </div>
        <div>
          <h2 className="text-xl font-semibold mb-4">{t('contact.info','Contact Information')}</h2>
          <p className="text-muted-foreground mb-2">{t('contact.info.email','Email')}: support@needs.com</p>
          <p className="text-muted-foreground mb-2">{t('contact.info.phone','Phone')}: +1 (555) 123-4567</p>
          <p className="text-muted-foreground">{t('contact.info.hours','Hours')}: {t('contact.info.hours.value','Monday-Friday, 9am-5pm PST')}</p>
        </div>
      </div>
    </div>
  );
}