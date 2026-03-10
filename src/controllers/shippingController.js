const axios = require('axios');

const EMSIFA = 'https://www.emsifa.com/api-wilayah-indonesia/api';

// GET /api/shipping/provinces
const getProvinces = async (req, res, next) => {
  try {
    const { data } = await axios.get(`${EMSIFA}/provinces.json`);
    res.json(data);
  } catch (err) { next(err); }
};

// GET /api/shipping/cities?province_id=X
const getCities = async (req, res, next) => {
  try {
    const { province_id } = req.query;
    if (!province_id) return res.status(400).json({ message: 'province_id is required.' });
    const { data } = await axios.get(`${EMSIFA}/regencies/${province_id}.json`);
    res.json(data);
  } catch (err) { next(err); }
};

// GET /api/shipping/districts?city_id=X
const getDistricts = async (req, res, next) => {
  try {
    const { city_id } = req.query;
    if (!city_id) return res.status(400).json({ message: 'city_id is required.' });
    const { data } = await axios.get(`${EMSIFA}/districts/${city_id}.json`);
    res.json(data);
  } catch (err) { next(err); }
};

module.exports = { getProvinces, getCities, getDistricts };
