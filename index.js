const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const cors = require("cors");
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { format } = require('date-fns');
const router = require('./Routes/route');
const dotEnv = require('dotenv')
const app = express();
dotEnv.config()

app.use(cors());
app.use(bodyParser.json());

const port = process.env.PORT || 8080;

let initialEnergyValue = null;
let firstStoredEnergyValue = null;
let isFirstDataStoredToday = false;

const config = {
  host: process.env.host,
  user: process.env.user,
  password: process.env.password,
  database: process.env.database,
  port:process.env.port
};

// Routes are coming from Routes folder route.js
app.use('/api', router);

async function initializeInitialEnergyValue() {
  try {
    console.log("Initializing initial energy value...");
    const connection = await mysql.createConnection(config);

    const yesterday = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd');
    const today = format(new Date(), 'yyyy-MM-dd');
    const previousDayQuery = `
      SELECT TotalNet_KWH_meter_70, TotalNet_KWH_meter_40, TotalNet_KWH_meter_69, TotalNet_KWH_meter_41 
      FROM sensordata 
      WHERE DATE(timestamp) = ? 
      ORDER BY timestamp DESC 
      LIMIT 1
    `;
    const todayFirstRecordQuery = `
      SELECT TotalNet_KWH_meter_70, TotalNet_KWH_meter_40, TotalNet_KWH_meter_69, TotalNet_KWH_meter_41 
      FROM sensordata 
      WHERE DATE(timestamp) = ? 
      ORDER BY timestamp ASC 
      LIMIT 1
    `;

    const [previousDayRows] = await connection.execute(previousDayQuery, [yesterday]);
    if (previousDayRows.length > 0) {
      initialEnergyValue = {
        meter70: previousDayRows[0].TotalNet_KWH_meter_70,
        meter40: previousDayRows[0].TotalNet_KWH_meter_40,
        meter69: previousDayRows[0].TotalNet_KWH_meter_69,
        meter41: previousDayRows[0].TotalNet_KWH_meter_41,
      };
      console.log("Initial energy value stored from previous day:", initialEnergyValue);
    } else {
      console.log("No data found for the previous day. Fetching today's first record.");
      const [todayRows] = await connection.execute(todayFirstRecordQuery, [today]);
      if (todayRows.length > 0) {
        initialEnergyValue = {
          meter70: todayRows[0].TotalNet_KWH_meter_70,
          meter40: todayRows[0].TotalNet_KWH_meter_40,
          meter69: todayRows[0].TotalNet_KWH_meter_69,
          meter41: todayRows[0].TotalNet_KWH_meter_41,
        };
        console.log("Initial energy value set to today's first record:", initialEnergyValue);
      } else {
        console.log("No data found for today yet.");
      }
    }

    await connection.end();
  } catch (error) {
    console.error("Error initializing initial energy value:", error);
  }
}

async function fetchDataAndStore() {
  try {
    console.log("Fetching and storing sensor data...");
    const response = await axios.get("https://vems-api.onrender.com/api/sensordata");
    const newData = response.data[0];

    if (initialEnergyValue === null) {
      initialEnergyValue = {
        meter70: newData.TotalNet_KWH_meter_70,
        meter40: newData.TotalNet_KWH_meter_40,
        meter69: newData.TotalNet_KWH_meter_69,
        meter41: newData.TotalNet_KWH_meter_41,
      };
      console.log("Setting initial energy value to the current value:", initialEnergyValue);
    }

    const energyConsumption = {
      meter70: newData.TotalNet_KWH_meter_70 - initialEnergyValue.meter70,
      meter40: newData.TotalNet_KWH_meter_40 - initialEnergyValue.meter40,
      meter69: newData.TotalNet_KWH_meter_69 - initialEnergyValue.meter69,
      meter41: newData.TotalNet_KWH_meter_41 - initialEnergyValue.meter41,
    };

    const todayDate = format(new Date(), 'yyyy-MM-dd');

    const query = `
      INSERT INTO sensordata (timestamp, 
        Total_KW_meter_70, TotalNet_KWH_meter_70, Total_KVA_meter_70, Avg_PF_meter_70, TotalNet_KVAH_meter_70, 
        Total_KW_meter_40, TotalNet_KWH_meter_40, Total_KVA_meter_40, Avg_PF_meter_40, TotalNet_KVAH_meter_40, 
        Total_KW_meter_69, TotalNet_KWH_meter_69, Total_KVA_meter_69, Avg_PF_meter_69, TotalNet_KVAH_meter_69, 
        Total_KW_meter_41, TotalNet_KWH_meter_41, Total_KVA_meter_41, Avg_PF_meter_41, TotalNet_KVAH_meter_41, 
        energy_consumption_meter_70, energy_consumption_meter_40, energy_consumption_meter_69, energy_consumption_meter_41) 
      VALUES (NOW(), 
        ?, ?, ?, ?, ?, 
        ?, ?, ?, ?, ?, 
        ?, ?, ?, ?, ?, 
        ?, ?, ?, ?, ?, 
        ?, ?, ?, ?)
    `;
    const values = [
      newData.Total_KW_meter_70, newData.TotalNet_KWH_meter_70, newData.Total_KVA_meter_70, newData.Avg_PF_meter_70, newData.TotalNet_KVAH_meter_70,
      newData.Total_KW_meter_40, newData.TotalNet_KWH_meter_40, newData.Total_KVA_meter_40, newData.Avg_PF_meter_40, newData.TotalNet_KVAH_meter_40,
      newData.Total_KW_meter_69, newData.TotalNet_KWH_meter_69, newData.Total_KVA_meter_69, newData.Avg_PF_meter_69, newData.TotalNet_KVAH_meter_69,
      newData.Total_KW_meter_41, newData.TotalNet_KWH_meter_41, newData.Total_KVA_meter_41, newData.Avg_PF_meter_41, newData.TotalNet_KVAH_meter_41,
      energyConsumption.meter70,
      energyConsumption.meter40,
      energyConsumption.meter69,
      energyConsumption.meter41
    ];

    console.log("Executing query:", query);
    console.log("With values:", values);

    const connection = await mysql.createConnection(config);
    const [result] = await connection.query(query, values);
    await connection.end();

    console.log("Sensor data stored successfully:", newData);
    console.log("Database insert result:", result);

    if (!isFirstDataStoredToday) {
      firstStoredEnergyValue = {
        meter70: newData.TotalNet_KWH_meter_70,
        meter40: newData.TotalNet_KWH_meter_40,
        meter69: newData.TotalNet_KWH_meter_69,
        meter41: newData.TotalNet_KWH_meter_41,
      };
      isFirstDataStoredToday = true;
      console.log("First stored energy value for today:", firstStoredEnergyValue);
    }

    const currentDate = format(new Date(), 'yyyy-MM-dd');
    const fileName = `VITB_${currentDate}.txt`;
    const filePath = path.join(__dirname, "VIT-Data", fileName);

    appendDataToFile(newData, filePath);
  } catch (error) {
    console.error("Error fetching and storing sensor data:", error);
  }
}

async function appendDataToFile(data, filePath) {
  try {
    console.log("Appending data to file:", filePath);
    const fileContent = `${format(new Date(), 'yyyy-MM-dd HH:mm:ss')},${data.Total_KW_meter_70},${data.TotalNet_KWH_meter_70},${data.Total_KVA_meter_70},${data.Avg_PF_meter_70},${data.TotalNet_KVAH_meter_70},${data.Total_KW_meter_40},${data.TotalNet_KWH_meter_40},${data.Total_KVA_meter_40},${data.Avg_PF_meter_40},${data.TotalNet_KVAH_meter_40},${data.Total_KW_meter_69},${data.TotalNet_KWH_meter_69},${data.Total_KVA_meter_69},${data.Avg_PF_meter_69},${data.TotalNet_KVAH_meter_69},${data.Total_KW_meter_41},${data.TotalNet_KWH_meter_41},${data.Total_KVA_meter_41},${data.Avg_PF_meter_41},${data.TotalNet_KVAH_meter_41}\n`;
    fs.appendFile(filePath, fileContent, (error) => {
      if (error) {
        console.error("Error appending data to file:", error);
      } else {
        console.log("Data appended to file successfully:", filePath);
      }
    });
  } catch (error) {
    console.error("Error appending data to file:", error);
  }
}

initializeInitialEnergyValue();
setInterval(fetchDataAndStore, 60000);

app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});