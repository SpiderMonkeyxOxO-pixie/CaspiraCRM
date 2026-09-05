import adobeAcrobatSign from "../../assets/integrations/adobe_acrobat_sign.png";
import aircall from "../../assets/integrations/aircall.png";
import amazonSes from "../../assets/integrations/amazon_ses.png";
import anthropicClaude from "../../assets/integrations/anthropic_claude.png";
import asana from "../../assets/integrations/asana.png";
import azureOpenai from "../../assets/integrations/azure_openai.png";
import bitbucket from "../../assets/integrations/bitbucket.png";
import box from "../../assets/integrations/box.png";
import brevo from "../../assets/integrations/brevo.png";
import calendly from "../../assets/integrations/calendly.png";
import chargebee from "../../assets/integrations/chargebee.png";
import clickup from "../../assets/integrations/clickup.png";
import docusign from "../../assets/integrations/docusign.png";
import dropbox from "../../assets/integrations/dropbox.png";
import dropboxSign from "../../assets/integrations/dropbox_sign.png";
import facebookMessenger from "../../assets/integrations/facebook_messenger.png";
import freshdesk from "../../assets/integrations/freshdesk.png";
import github from "../../assets/integrations/github.png";
import gitlab from "../../assets/integrations/gitlab.png";
import googleAds from "../../assets/integrations/google_ads.png";
import googleAnalytics4 from "../../assets/integrations/google_analytics_4.png";
import googleBusinessProfile from "../../assets/integrations/google_business_profile.png";
import googleForms from "../../assets/integrations/google_forms.png";
import googleGemini from "../../assets/integrations/google_gemini.png";
import googleWorkspace from "../../assets/integrations/google_workspace.png";
import instagramMessaging from "../../assets/integrations/instagram_messaging.png";
import intercom from "../../assets/integrations/intercom.png";
import jira from "../../assets/integrations/jira.png";
import linkedinLeadGen from "../../assets/integrations/linkedin_lead_gen.png";
import mailchimp from "../../assets/integrations/mailchimp.png";
import make from "../../assets/integrations/make.png";
import metaLeadAds from "../../assets/integrations/meta_lead_ads.png";
import microsoft365 from "../../assets/integrations/microsoft_365.png";
import microsoftClarity from "../../assets/integrations/microsoft_clarity.png";
import mondayCom from "../../assets/integrations/monday_com.png";
import ollama from "../../assets/integrations/ollama.png";
import openai from "../../assets/integrations/openai.png";
import paddle from "../../assets/integrations/paddle.png";
import paypal from "../../assets/integrations/paypal.png";
import plaid from "../../assets/integrations/plaid.png";
import quickbooksOnline from "../../assets/integrations/quickbooks_online.png";
import razorpay from "../../assets/integrations/razorpay.png";
import resend from "../../assets/integrations/resend.png";
import ringcentral from "../../assets/integrations/ringcentral.png";
import sendgrid from "../../assets/integrations/sendgrid.png";
import shopify from "../../assets/integrations/shopify.png";
import slack from "../../assets/integrations/slack.png";
import square from "../../assets/integrations/square.png";
import stripe from "../../assets/integrations/stripe.png";
import telegramBotApi from "../../assets/integrations/telegram_bot_api.png";
import tiktokLeadGen from "../../assets/integrations/tiktok_lead_gen.png";
import trello from "../../assets/integrations/trello.png";
import twilio from "../../assets/integrations/twilio.png";
import typeform from "../../assets/integrations/typeform.png";
import whatsappBusiness from "../../assets/integrations/whatsapp_business.png";
import wiseBusiness from "../../assets/integrations/wise_business.png";
import woocommerce from "../../assets/integrations/woocommerce.png";
import xero from "../../assets/integrations/xero.png";
import zapier from "../../assets/integrations/zapier.png";
import zendesk from "../../assets/integrations/zendesk.png";
import zoom from "../../assets/integrations/zoom.png";

// Official provider logos, used purely to identify each provider's own
// product — the same nominative use every integration marketplace relies
// on (Zapier, Make, HubSpot, etc. all display partner logos this way).
// One entry per provider `key` across every Integration Center phase —
// keep this in sync with mockIntegrationsData.js / mock*Data.js's PROVIDERS.
const LOGOS = {
  adobe_acrobat_sign: adobeAcrobatSign,
  aircall,
  amazon_ses: amazonSes,
  anthropic_claude: anthropicClaude,
  asana,
  azure_openai: azureOpenai,
  bitbucket,
  box,
  brevo,
  calendly,
  chargebee,
  clickup,
  docusign,
  dropbox,
  dropbox_sign: dropboxSign,
  facebook_messenger: facebookMessenger,
  freshdesk,
  github,
  gitlab,
  google_ads: googleAds,
  google_analytics_4: googleAnalytics4,
  google_business_profile: googleBusinessProfile,
  google_forms: googleForms,
  google_gemini: googleGemini,
  google_workspace: googleWorkspace,
  instagram_messaging: instagramMessaging,
  intercom,
  jira,
  linkedin_lead_gen: linkedinLeadGen,
  mailchimp,
  make,
  meta_lead_ads: metaLeadAds,
  microsoft_365: microsoft365,
  microsoft_clarity: microsoftClarity,
  monday_com: mondayCom,
  ollama,
  openai,
  paddle,
  paypal,
  plaid,
  quickbooks_online: quickbooksOnline,
  razorpay,
  resend,
  ringcentral,
  sendgrid,
  shopify,
  slack,
  square,
  stripe,
  telegram_bot_api: telegramBotApi,
  tiktok_lead_gen: tiktokLeadGen,
  trello,
  twilio,
  typeform,
  whatsapp_business: whatsappBusiness,
  wise_business: wiseBusiness,
  woocommerce,
  xero,
  zapier,
  zendesk,
  zoom,
};

export default function ProviderLogo({ providerKey, name, size = 32 }) {
  const src = LOGOS[providerKey];

  if (src) {
    return (
      <div
        className="rounded-lg bg-white flex items-center justify-center shrink-0 overflow-hidden"
        style={{ width: size, height: size }}
      >
        <img src={src} alt={`${name} logo`} className="w-full h-full object-contain p-1" />
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={`${name} logo`}
      className="rounded-lg flex items-center justify-center shrink-0 bg-blue-500/15 border border-blue-500/30 text-blue-400 font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {name.slice(0, 1)}
    </div>
  );
}
