import DemoNotice from "./DemoNotice";

// Wraps a route whose page still runs on built-in sample data.
export default function PreviewPage({ module, children }) {
  return (
    <>
      <DemoNotice module={module} />
      {children}
    </>
  );
}
