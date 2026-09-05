import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import prisma from "../lib/prisma.js";
import { signToken, verifyToken } from "../utils/jwt.js";
import { toApi } from "../utils/serialize.js";

function publicUser(user) {
  const { passwordHash, twoFactorSecret, resetToken, resetTokenExpires, ...rest } = user;
  return toApi(rest);
}

export async function login(req, res) {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: "Username and password are required" });

  const user = await prisma.user.findFirst({ where: { OR: [{ username }, { email: username }] } });
  if (!user) return res.status(401).json({ message: "Invalid username or password" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ message: "Invalid username or password" });

  if (user.twoFactorEnabled) {
    // A short-lived token identifying who's mid-2FA — the frontend already
    // stores this as `tempAuthToken` and sends it as the Bearer token on
    // the follow-up verify-2fa call (see axiosInstance.js's interceptor).
    const tempToken = signToken({ sub: user.id, purpose: "2fa-pending" });
    return res.json({ token: tempToken, user: publicUser(user), require2FA: true });
  }

  const token = signToken({ sub: user.id, role: user.role });
  res.json({ token, user: publicUser(user), require2FA: false });
}

export async function verify2FA(req, res) {
  const { otp } = req.body;
  const header = req.headers.authorization || "";
  const tempToken = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!tempToken) return res.status(401).json({ message: "2FA session expired — please log in again" });

  let payload;
  try {
    payload = verifyToken(tempToken);
  } catch {
    return res.status(401).json({ message: "2FA session expired — please log in again" });
  }
  if (payload.purpose !== "2fa-pending") return res.status(401).json({ message: "Invalid 2FA session" });

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.twoFactorSecret) return res.status(401).json({ message: "2FA is not configured for this account" });

  const valid = speakeasy.totp.verify({ secret: user.twoFactorSecret, encoding: "base32", token: otp, window: 1 });
  if (!valid) return res.status(400).json({ message: "Incorrect verification code" });

  const token = signToken({ sub: user.id, role: user.role });
  res.json({ success: true, token, user: publicUser(user) });
}

export async function me(req, res) {
  res.json({ user: publicUser(req.user) });
}

export async function logout(_req, res) {
  res.json({ message: "Logged out" });
}

export async function updateFCM(req, res) {
  const { fcmToken } = req.body;
  const user = await prisma.user.update({ where: { id: req.user.id }, data: { fcmToken } });
  res.json({ success: true, user: publicUser(user) });
}

export async function listUsers(_req, res) {
  const users = await prisma.user.findMany({ orderBy: { name: "asc" } });
  res.json({ users: users.map(publicUser) });
}

export async function register(req, res) {
  const { name, username, email, password, role, department } = req.body;
  if (!name || !username || !email || !password) return res.status(400).json({ message: "name, username, email and password are required" });

  const exists = await prisma.user.findFirst({ where: { OR: [{ username }, { email }] } });
  if (exists) return res.status(409).json({ message: "A user with that username or email already exists" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, fullName: name, username, email, passwordHash, role: role || "User", department: department || null },
  });
  res.status(201).json({ user: publicUser(user) });
}

export async function updateUser(req, res) {
  const { password, ...rest } = req.body;
  const data = { ...rest };
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.update({ where: { id: req.params.id }, data });
  res.json({ success: true, user: publicUser(user) });
}

export async function updateUserStatus(req, res) {
  const user = await prisma.user.update({ where: { id: req.params.id }, data: { status: req.body.status } });
  res.json({ success: true, user: publicUser(user) });
}

export async function updateUserRole(req, res) {
  const user = await prisma.user.update({ where: { id: req.params.id }, data: { role: req.body.role } });
  res.json({ success: true, user: publicUser(user) });
}

export async function deleteUser(req, res) {
  await prisma.user.delete({ where: { id: req.params.userId } });
  res.json({ success: true });
}

export async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const valid = await bcrypt.compare(currentPassword || "", user.passwordHash);
  if (!valid) return res.status(400).json({ success: false, message: "Current password is incorrect" });
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  res.json({ success: true, message: "Password updated" });
}

// --- 2FA setup (real TOTP, not the mock's always-pass stub) ---
export async function setup2FA(req, res) {
  const secret = speakeasy.generateSecret({ name: `Caspira CRM (${req.user.email})` });
  await prisma.user.update({ where: { id: req.user.id }, data: { twoFactorSecret: secret.base32 } });
  const qrCode = await QRCode.toDataURL(secret.otpauth_url);
  res.json({ qrCode, secret: secret.base32 });
}

export async function confirm2FA(req, res) {
  const { otp } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user.twoFactorSecret) return res.status(400).json({ message: "Run 2FA setup first" });
  const valid = speakeasy.totp.verify({ secret: user.twoFactorSecret, encoding: "base32", token: otp, window: 1 });
  if (!valid) return res.status(400).json({ message: "Incorrect verification code" });
  await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
  res.json({ success: true });
}
