import { Router } from 'express';
import * as indexController from '../controllers/indexController';

const router = Router();

router.get('/status', indexController.getStatus);
router.get('/sections', indexController.getSectionStats);
router.post('/refresh', indexController.forceRefresh);

export default router;
