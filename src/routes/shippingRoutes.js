const express = require('express');
const router  = express.Router();
const { getProvinces, getCities, getDistricts } = require('../controllers/shippingController');

router.get('/provinces',  getProvinces);
router.get('/cities',     getCities);
router.get('/districts',  getDistricts);

module.exports = router;
