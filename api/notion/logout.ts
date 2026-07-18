import type {VercelRequest, VercelResponse} from '@vercel/node';
import {clearCookie, SESSION_COOKIE} from '../_lib/session';

export default function handler(_req: VercelRequest, res: VercelResponse) {
	clearCookie(res, SESSION_COOKIE);
	res.status(200).json({ok: true});
}
