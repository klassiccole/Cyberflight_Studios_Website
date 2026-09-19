import {createBookingHandlers} from '../../../lib/booking-submit.mjs';
const handlers=createBookingHandlers({});
export const onRequest=context=>handlers.agreement(context);
