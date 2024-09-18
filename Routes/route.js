const express = require("express");
const contoller = require('../Controllers/controller');

const router = express.Router();

router.get('/sensordata', contoller.sensorData);
router.get('/previousDayEnergy',contoller.prevDayEnergy);
router.get('/energy-consumption', contoller.energyConsumption);
router.get('/realtime-graph',contoller.realTimeGraph)
router.get('/daywise-graph/:date',contoller.dailyWiseGraph)
router.get('/highest-kva', contoller.getHighestKva);
router.get('/sensordatabydate/:date', contoller.sensorDataByDate);

module.exports = router;