import DemoNotice from "./DemoNotice";

// Wraps a route whose page still runs on built-in sample data.
// `live` skips the notice when the page has switched to its server screen.
export default function PreviewPage({ module, live = false, children }) {
  if (live) return children;
  return (
    <>
      <DemoNotice module={module} />
      {children}
    </>
  );
}
