export function errorHandler(err, _req, res, _next) {
  console.error(err);
  if (err.code === "P2025") return res.status(404).json({ message: "Record not found" });
  if (err.code === "P2002") return res.status(409).json({ message: "A record with that value already exists" });
  if (err.code === "P2003") return res.status(400).json({ message: "This action references a record that doesn't exist" });
  res.status(err.status || 500).json({ message: err.message || "Something went wrong" });
}
