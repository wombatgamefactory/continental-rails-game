// GENERATED FILE - do not edit by hand.
// Source: src/engine/data/route-map.json
// Regenerate with: node tools/build-route-map-module.mjs
//
// Board: 600 x 350 mm (board.w, board.h). Cities: id, name, x, y (mm on the
// board), role ("w" = west start city, "e" = east start city, "" = inland
// city). Routes: a, b (city ids), terrain (one letter per slot from a to b:
// G = Ground, T = Tunnel, B = Bridge, W = wild slot, any built tile fits),
// slots (x, y, angle for the UI), line (whether the art draws a black line),
// bow. Also: slot {l, w, outline}, city_r, city_style, labels (where the art
// puts each city name).
export const ROUTE_MAP = {
 "title": "Continental Rails route map v3",
 "board": {
  "w": 600,
  "h": 350
 },
 "slot": {
  "l": 25.26,
  "w": 8.26,
  "outline": 0.68
 },
 "city_r": 8.86,
 "city_style": {
  "inland": {
   "r": 8.86,
   "fill_r": 7.17
  },
  "start": {
   "r": 9.29,
   "fill_r": 6.67
  }
 },
 "cities": [
  {
   "id": "SEA",
   "name": "Seattle",
   "x": 21.96,
   "y": 15.28,
   "role": "w"
  },
  {
   "id": "POR",
   "name": "Portland",
   "x": 21.96,
   "y": 134.53,
   "role": "w"
  },
  {
   "id": "SAC",
   "name": "Sacramento",
   "x": 21.96,
   "y": 233.51,
   "role": "w"
  },
  {
   "id": "LAX",
   "name": "Los Angeles",
   "x": 21.96,
   "y": 335.97,
   "role": "w"
  },
  {
   "id": "YAK",
   "name": "Yakima",
   "x": 88.4,
   "y": 29.89,
   "role": ""
  },
  {
   "id": "TDL",
   "name": "The Dalles",
   "x": 82.17,
   "y": 108.64,
   "role": ""
  },
  {
   "id": "SPO",
   "name": "Spokane",
   "x": 165.47,
   "y": 64.96,
   "role": ""
  },
  {
   "id": "BOI",
   "name": "Boise",
   "x": 180.33,
   "y": 118.44,
   "role": ""
  },
  {
   "id": "REN",
   "name": "Reno",
   "x": 144.09,
   "y": 188.8,
   "role": ""
  },
  {
   "id": "SLC",
   "name": "Salt Lake City",
   "x": 214.65,
   "y": 185.65,
   "role": ""
  },
  {
   "id": "FRE",
   "name": "Fresno",
   "x": 93.93,
   "y": 253.9,
   "role": ""
  },
  {
   "id": "TON",
   "name": "Tonopah",
   "x": 191.25,
   "y": 255.64,
   "role": ""
  },
  {
   "id": "SBD",
   "name": "San Bernardino",
   "x": 85.47,
   "y": 333.97,
   "role": ""
  },
  {
   "id": "LVG",
   "name": "Las Vegas",
   "x": 174.47,
   "y": 307.47,
   "role": ""
  },
  {
   "id": "PHX",
   "name": "Phoenix",
   "x": 258.47,
   "y": 333.97,
   "role": ""
  },
  {
   "id": "GFA",
   "name": "Great Falls",
   "x": 304.86,
   "y": 12.96,
   "role": ""
  },
  {
   "id": "HEL",
   "name": "Helena",
   "x": 273.97,
   "y": 83.96,
   "role": ""
  },
  {
   "id": "BIL",
   "name": "Billings",
   "x": 336.98,
   "y": 80.96,
   "role": ""
  },
  {
   "id": "DEN",
   "name": "Denver",
   "x": 302.97,
   "y": 155.79,
   "role": ""
  },
  {
   "id": "SFE",
   "name": "Santa Fe",
   "x": 301.17,
   "y": 259.67,
   "role": ""
  },
  {
   "id": "ELP",
   "name": "El Paso",
   "x": 328.17,
   "y": 335.97,
   "role": ""
  },
  {
   "id": "BIS",
   "name": "Bismarck",
   "x": 445.3,
   "y": 73.46,
   "role": ""
  },
  {
   "id": "FAR",
   "name": "Fargo",
   "x": 509.98,
   "y": 18.86,
   "role": ""
  },
  {
   "id": "NPL",
   "name": "North Platte",
   "x": 420.7,
   "y": 118.7,
   "role": ""
  },
  {
   "id": "SXC",
   "name": "Sioux City",
   "x": 517.9,
   "y": 122.46,
   "role": ""
  },
  {
   "id": "PUE",
   "name": "Pueblo",
   "x": 381.98,
   "y": 189.84,
   "role": ""
  },
  {
   "id": "GRI",
   "name": "Grand Island",
   "x": 452.86,
   "y": 187.48,
   "role": ""
  },
  {
   "id": "DOD",
   "name": "Dodge City",
   "x": 405.46,
   "y": 258,
   "role": ""
  },
  {
   "id": "WIC",
   "name": "Wichita",
   "x": 503.62,
   "y": 255.65,
   "role": ""
  },
  {
   "id": "AMA",
   "name": "Amarillo",
   "x": 419.02,
   "y": 304.74,
   "role": ""
  },
  {
   "id": "ABI",
   "name": "Abilene",
   "x": 508.3,
   "y": 334.31,
   "role": ""
  },
  {
   "id": "MIN",
   "name": "Minneapolis",
   "x": 577.98,
   "y": 35.66,
   "role": "e"
  },
  {
   "id": "OMA",
   "name": "Omaha",
   "x": 577.98,
   "y": 147.58,
   "role": "e"
  },
  {
   "id": "KCY",
   "name": "Kansas City",
   "x": 577.99,
   "y": 238.24,
   "role": "e"
  },
  {
   "id": "FTW",
   "name": "Fort Worth",
   "x": 577.98,
   "y": 336.06,
   "role": "e"
  }
 ],
 "routes": [
  {
   "a": "SEA",
   "b": "YAK",
   "terrain": "T",
   "bow": 0.1425,
   "line": true,
   "slots": [
    {
     "x": 54.68,
     "y": 24.97,
     "angle": 12.31,
     "type": "T"
    }
   ]
  },
  {
   "a": "SEA",
   "b": "TDL",
   "terrain": "GTB",
   "bow": 0.745,
   "line": true,
   "slots": [
    {
     "x": 22.84,
     "y": 47.57,
     "angle": 77.09,
     "type": "G"
    },
    {
     "x": 33.86,
     "y": 73.7,
     "angle": 57.17,
     "type": "T"
    },
    {
     "x": 53.11,
     "y": 94.52,
     "angle": 37.29,
     "type": "B"
    }
   ]
  },
  {
   "a": "YAK",
   "b": "TDL",
   "terrain": "TB",
   "bow": 0.4725,
   "line": false,
   "slots": [
    {
     "x": 78.05,
     "y": 54.71,
     "angle": 103.75,
     "type": "T"
    },
    {
     "x": 75.85,
     "y": 82.5,
     "angle": 85.29,
     "type": "B"
    }
   ]
  },
  {
   "a": "YAK",
   "b": "SPO",
   "terrain": "BG",
   "bow": -0.295,
   "line": false,
   "slots": [
    {
     "x": 116.3,
     "y": 36.44,
     "angle": 18.86,
     "type": "B"
    },
    {
     "x": 142.21,
     "y": 48.23,
     "angle": 30.07,
     "type": "G"
    }
   ]
  },
  {
   "a": "SPO",
   "b": "GFA",
   "terrain": "TBTT",
   "bow": -0.445,
   "line": true,
   "slots": [
    {
     "x": 191.47,
     "y": 42.91,
     "angle": -34.63,
     "type": "T"
    },
    {
     "x": 216.15,
     "y": 28.72,
     "angle": -25.19,
     "type": "B"
    },
    {
     "x": 242.82,
     "y": 18.77,
     "angle": -15.73,
     "type": "T"
    },
    {
     "x": 270.77,
     "y": 13.33,
     "angle": -6.27,
     "type": "T"
    }
   ]
  },
  {
   "a": "SPO",
   "b": "HEL",
   "terrain": "TBW",
   "bow": -0.3325,
   "line": false,
   "slots": [
    {
     "x": 192.96,
     "y": 62.82,
     "angle": 0.31,
     "type": "T"
    },
    {
     "x": 221.32,
     "y": 65.34,
     "angle": 9.94,
     "type": "B"
    },
    {
     "x": 248.84,
     "y": 72.6,
     "angle": 19.63,
     "type": "W"
    }
   ]
  },
  {
   "a": "SPO",
   "b": "TDL",
   "terrain": "GG",
   "bow": 0.2,
   "line": true,
   "slots": [
    {
     "x": 134.44,
     "y": 76.39,
     "angle": 155.78,
     "type": "G"
    },
    {
     "x": 109.21,
     "y": 89.62,
     "angle": 148.88,
     "type": "G"
    }
   ]
  },
  {
   "a": "SPO",
   "b": "BOI",
   "terrain": "T",
   "bow": -0.8125,
   "line": false,
   "slots": [
    {
     "x": 184.55,
     "y": 89.01,
     "angle": 76.68,
     "type": "T"
    }
   ]
  },
  {
   "a": "TDL",
   "b": "BOI",
   "terrain": "TB",
   "bow": 0,
   "line": true,
   "slots": [
    {
     "x": 117.07,
     "y": 112.13,
     "angle": 5.7,
     "type": "T"
    },
    {
     "x": 145.43,
     "y": 114.96,
     "angle": 5.7,
     "type": "B"
    }
   ]
  },
  {
   "a": "TDL",
   "b": "POR",
   "terrain": "B",
   "bow": 0,
   "line": true,
   "slots": [
    {
     "x": 52.06,
     "y": 121.59,
     "angle": 156.73,
     "type": "B"
    }
   ]
  },
  {
   "a": "GFA",
   "b": "HEL",
   "terrain": "T",
   "bow": -0.3,
   "line": true,
   "slots": [
    {
     "x": 294.78,
     "y": 50.79,
     "angle": 113.52,
     "type": "T"
    }
   ]
  },
  {
   "a": "GFA",
   "b": "BIL",
   "terrain": "G",
   "bow": -0.3,
   "line": true,
   "slots": [
    {
     "x": 326.05,
     "y": 44.53,
     "angle": 64.73,
     "type": "G"
    }
   ]
  },
  {
   "a": "GFA",
   "b": "BIS",
   "terrain": "GBGB",
   "bow": -0.4125,
   "line": true,
   "slots": [
    {
     "x": 340.59,
     "y": 16.11,
     "angle": 10.45,
     "type": "G"
    },
    {
     "x": 368.13,
     "y": 23.36,
     "angle": 19.01,
     "type": "B"
    },
    {
     "x": 394.28,
     "y": 34.62,
     "angle": 27.6,
     "type": "G"
    },
    {
     "x": 418.46,
     "y": 49.66,
     "angle": 36.16,
     "type": "B"
    }
   ]
  },
  {
   "a": "HEL",
   "b": "BOI",
   "terrain": "TT",
   "bow": -0.0425,
   "line": true,
   "slots": [
    {
     "x": 240.86,
     "y": 97.18,
     "angle": 159.09,
     "type": "T"
    },
    {
     "x": 214.11,
     "y": 107.03,
     "angle": 160.48,
     "type": "T"
    }
   ]
  },
  {
   "a": "HEL",
   "b": "DEN",
   "terrain": "T",
   "bow": 0.3,
   "line": true,
   "slots": [
    {
     "x": 283.05,
     "y": 122.07,
     "angle": 68.02,
     "type": "T"
    }
   ]
  },
  {
   "a": "BIL",
   "b": "DEN",
   "terrain": "TW",
   "bow": -0.3,
   "line": false,
   "slots": [
    {
     "x": 330.85,
     "y": 107.71,
     "angle": 108.56,
     "type": "T"
    },
    {
     "x": 319.09,
     "y": 133.59,
     "angle": 120.31,
     "type": "W"
    }
   ]
  },
  {
   "a": "BIL",
   "b": "BIS",
   "terrain": "WBT",
   "bow": -0.28,
   "line": false,
   "slots": [
    {
     "x": 362.91,
     "y": 73.52,
     "angle": -12.1,
     "type": "W"
    },
    {
     "x": 390.61,
     "y": 69.61,
     "angle": -3.96,
     "type": "B"
    },
    {
     "x": 418.59,
     "y": 69.66,
     "angle": 4.18,
     "type": "T"
    }
   ]
  },
  {
   "a": "BIL",
   "b": "NPL",
   "terrain": "TG",
   "bow": 0.295,
   "line": true,
   "slots": [
    {
     "x": 363.32,
     "y": 99.62,
     "angle": 29.44,
     "type": "T"
    },
    {
     "x": 389.27,
     "y": 111.31,
     "angle": 19.1,
     "type": "G"
    }
   ]
  },
  {
   "a": "FAR",
   "b": "BIS",
   "terrain": "GB",
   "bow": 0.4,
   "line": false,
   "slots": [
    {
     "x": 483.57,
     "y": 31.16,
     "angle": 147.34,
     "type": "G"
    },
    {
     "x": 461.86,
     "y": 49.49,
     "angle": 132.32,
     "type": "B"
    }
   ]
  },
  {
   "a": "FAR",
   "b": "MIN",
   "terrain": "G",
   "bow": 0,
   "line": true,
   "slots": [
    {
     "x": 543.98,
     "y": 27.26,
     "angle": 13.87,
     "type": "G"
    }
   ]
  },
  {
   "a": "FAR",
   "b": "SXC",
   "terrain": "BGB",
   "bow": -0.5825,
   "line": false,
   "slots": [
    {
     "x": 523.24,
     "y": 42.28,
     "angle": 68.66,
     "type": "B"
    },
    {
     "x": 529.44,
     "y": 69.47,
     "angle": 85.62,
     "type": "G"
    },
    {
     "x": 527.44,
     "y": 97.3,
     "angle": 102.59,
     "type": "B"
    }
   ]
  },
  {
   "a": "BIS",
   "b": "NPL",
   "terrain": "T",
   "bow": 0.5325,
   "line": false,
   "slots": [
    {
     "x": 426.84,
     "y": 92.74,
     "angle": 118.54,
     "type": "T"
    }
   ]
  },
  {
   "a": "BIS",
   "b": "SXC",
   "terrain": "TB",
   "bow": -0.14,
   "line": false,
   "slots": [
    {
     "x": 471.33,
     "y": 87.71,
     "angle": 31.41,
     "type": "T"
    },
    {
     "x": 494.95,
     "y": 103.65,
     "angle": 36.62,
     "type": "B"
    }
   ]
  },
  {
   "a": "MIN",
   "b": "SXC",
   "terrain": "GBG",
   "bow": -0.905,
   "line": true,
   "slots": [
    {
     "x": 579.85,
     "y": 67.51,
     "angle": 100.37,
     "type": "G"
    },
    {
     "x": 569.01,
     "y": 93.64,
     "angle": 124.68,
     "type": "B"
    },
    {
     "x": 548.37,
     "y": 112.99,
     "angle": 149,
     "type": "G"
    }
   ]
  },
  {
   "a": "NPL",
   "b": "SXC",
   "terrain": "BG",
   "bow": 0,
   "line": true,
   "slots": [
    {
     "x": 455.06,
     "y": 120.05,
     "angle": 2.23,
     "type": "B"
    },
    {
     "x": 483.54,
     "y": 121.15,
     "angle": 2.19,
     "type": "G"
    }
   ]
  },
  {
   "a": "SXC",
   "b": "OMA",
   "terrain": "B",
   "bow": 0,
   "line": true,
   "slots": [
    {
     "x": 547.94,
     "y": 135.02,
     "angle": 22.69,
     "type": "B"
    }
   ]
  },
  {
   "a": "NPL",
   "b": "PUE",
   "terrain": "BG",
   "bow": 0.4375,
   "line": false,
   "slots": [
    {
     "x": 401.17,
     "y": 138.01,
     "angle": 127.08,
     "type": "B"
    },
    {
     "x": 387.59,
     "y": 162.96,
     "angle": 110.03,
     "type": "G"
    }
   ]
  },
  {
   "a": "NPL",
   "b": "GRI",
   "terrain": "GG",
   "bow": -0.675,
   "line": false,
   "slots": [
    {
     "x": 441.5,
     "y": 135.57,
     "angle": 51.75,
     "type": "G"
    },
    {
     "x": 453.26,
     "y": 160.71,
     "angle": 78.14,
     "type": "G"
    }
   ]
  },
  {
   "a": "POR",
   "b": "REN",
   "terrain": "BTG",
   "bow": 0,
   "line": true,
   "slots": [
    {
     "x": 56.98,
     "y": 150.09,
     "angle": 23.96,
     "type": "B"
    },
    {
     "x": 83.03,
     "y": 161.66,
     "angle": 23.96,
     "type": "T"
    },
    {
     "x": 109.07,
     "y": 173.24,
     "angle": 23.96,
     "type": "G"
    }
   ]
  },
  {
   "a": "BOI",
   "b": "REN",
   "terrain": "BG",
   "bow": 0.46,
   "line": false,
   "slots": [
    {
     "x": 161.33,
     "y": 137.48,
     "angle": 126.26,
     "type": "B"
    },
    {
     "x": 148.56,
     "y": 162.27,
     "angle": 108.25,
     "type": "G"
    }
   ]
  },
  {
   "a": "BOI",
   "b": "SLC",
   "terrain": "BG",
   "bow": -0.7475,
   "line": false,
   "slots": [
    {
     "x": 202.68,
     "y": 133.66,
     "angle": 48.34,
     "type": "B"
    },
    {
     "x": 215.42,
     "y": 158.61,
     "angle": 77.55,
     "type": "G"
    }
   ]
  },
  {
   "a": "DEN",
   "b": "SLC",
   "terrain": "TT",
   "bow": -0.295,
   "line": true,
   "slots": [
    {
     "x": 274.31,
     "y": 172.12,
     "angle": 156.23,
     "type": "T"
    },
    {
     "x": 247.34,
     "y": 181.24,
     "angle": 166.42,
     "type": "T"
    }
   ]
  },
  {
   "a": "REN",
   "b": "SAC",
   "terrain": "TTG",
   "bow": 0,
   "line": true,
   "slots": [
    {
     "x": 109.79,
     "y": 201.35,
     "angle": 159.89,
     "type": "T"
    },
    {
     "x": 83.03,
     "y": 211.15,
     "angle": 159.9,
     "type": "T"
    },
    {
     "x": 56.26,
     "y": 220.95,
     "angle": 159.89,
     "type": "G"
    }
   ]
  },
  {
   "a": "REN",
   "b": "TON",
   "terrain": "GG",
   "bow": -0.425,
   "line": false,
   "slots": [
    {
     "x": 165.86,
     "y": 206.12,
     "angle": 46.58,
     "type": "G"
    },
    {
     "x": 182.24,
     "y": 229.33,
     "angle": 63.04,
     "type": "G"
    }
   ]
  },
  {
   "a": "SLC",
   "b": "TON",
   "terrain": "BG",
   "bow": -0.7875,
   "line": false,
   "slots": [
    {
     "x": 220.08,
     "y": 211.79,
     "angle": 93.1,
     "type": "B"
    },
    {
     "x": 211.31,
     "y": 238.03,
     "angle": 123.88,
     "type": "G"
    }
   ]
  },
  {
   "a": "SLC",
   "b": "SFE",
   "terrain": "GBT",
   "bow": -0.305,
   "line": false,
   "slots": [
    {
     "x": 240.63,
     "y": 199.18,
     "angle": 31.97,
     "type": "G"
    },
    {
     "x": 263.59,
     "y": 216.02,
     "angle": 40.54,
     "type": "B"
    },
    {
     "x": 283.78,
     "y": 236.1,
     "angle": 49.14,
     "type": "T"
    }
   ]
  },
  {
   "a": "DEN",
   "b": "PUE",
   "terrain": "TB",
   "bow": -0.155,
   "line": false,
   "slots": [
    {
     "x": 330.57,
     "y": 164.44,
     "angle": 20.38,
     "type": "T"
    },
    {
     "x": 356.73,
     "y": 175.71,
     "angle": 26.27,
     "type": "B"
    }
   ]
  },
  {
   "a": "DEN",
   "b": "SFE",
   "terrain": "GTB",
   "bow": -0.5825,
   "line": false,
   "slots": [
    {
     "x": 313.99,
     "y": 180.34,
     "angle": 74.04,
     "type": "G"
    },
    {
     "x": 317.62,
     "y": 208,
     "angle": 90.98,
     "type": "T"
    },
    {
     "x": 313.03,
     "y": 235.51,
     "angle": 107.97,
     "type": "B"
    }
   ]
  },
  {
   "a": "PUE",
   "b": "SFE",
   "terrain": "GTT",
   "bow": -0.43,
   "line": false,
   "slots": [
    {
     "x": 368.24,
     "y": 213.07,
     "angle": 126.64,
     "type": "G"
    },
    {
     "x": 349.19,
     "y": 233.57,
     "angle": 139.17,
     "type": "T"
    },
    {
     "x": 326.15,
     "y": 249.44,
     "angle": 151.69,
     "type": "T"
    }
   ]
  },
  {
   "a": "PUE",
   "b": "DOD",
   "terrain": "GG",
   "bow": -0.8675,
   "line": false,
   "slots": [
    {
     "x": 403.07,
     "y": 206.11,
     "angle": 54.03,
     "type": "G"
    },
    {
     "x": 412.05,
     "y": 232.2,
     "angle": 87.96,
     "type": "G"
    }
   ]
  },
  {
   "a": "GRI",
   "b": "OMA",
   "terrain": "BGB",
   "bow": 0,
   "line": true,
   "slots": [
    {
     "x": 488.27,
     "y": 176.19,
     "angle": -17.67,
     "type": "B"
    },
    {
     "x": 515.42,
     "y": 167.53,
     "angle": -17.68,
     "type": "G"
    },
    {
     "x": 542.58,
     "y": 158.87,
     "angle": -17.69,
     "type": "B"
    }
   ]
  },
  {
   "a": "GRI",
   "b": "KCY",
   "terrain": "GGB",
   "bow": 0,
   "line": true,
   "slots": [
    {
     "x": 489.01,
     "y": 202.15,
     "angle": 22.08,
     "type": "G"
    },
    {
     "x": 515.42,
     "y": 212.86,
     "angle": 22.07,
     "type": "G"
    },
    {
     "x": 541.83,
     "y": 223.57,
     "angle": 22.08,
     "type": "B"
    }
   ]
  },
  {
   "a": "GRI",
   "b": "DOD",
   "terrain": "BG",
   "bow": -0.6225,
   "line": true,
   "slots": [
    {
     "x": 447.24,
     "y": 217.83,
     "angle": 112.72,
     "type": "B"
    },
    {
     "x": 431.45,
     "y": 241.33,
     "angle": 135.16,
     "type": "G"
    }
   ]
  },
  {
   "a": "SAC",
   "b": "FRE",
   "terrain": "B",
   "bow": 0,
   "line": true,
   "slots": [
    {
     "x": 57.98,
     "y": 243.72,
     "angle": 15.66,
     "type": "B"
    }
   ]
  },
  {
   "a": "FRE",
   "b": "LAX",
   "terrain": "BGT",
   "bow": 0.725,
   "line": true,
   "slots": [
    {
     "x": 64.49,
     "y": 263.52,
     "angle": 151.07,
     "type": "B"
    },
    {
     "x": 42.4,
     "y": 281.31,
     "angle": 131.24,
     "type": "G"
    },
    {
     "x": 27.65,
     "y": 305.53,
     "angle": 111.43,
     "type": "T"
    }
   ]
  },
  {
   "a": "FRE",
   "b": "SBD",
   "terrain": "GT",
   "bow": -0.465,
   "line": false,
   "slots": [
    {
     "x": 99.56,
     "y": 280.71,
     "angle": 86.94,
     "type": "G"
    },
    {
     "x": 96.58,
     "y": 308.93,
     "angle": 105.15,
     "type": "T"
    }
   ]
  },
  {
   "a": "FRE",
   "b": "TON",
   "terrain": "TT",
   "bow": -0.755,
   "line": true,
   "slots": [
    {
     "x": 128.76,
     "y": 236.67,
     "angle": -10.46,
     "type": "T"
    },
    {
     "x": 157.06,
     "y": 237.18,
     "angle": 12.52,
     "type": "T"
    }
   ]
  },
  {
   "a": "FRE",
   "b": "LVG",
   "terrain": "TG",
   "bow": -0.545,
   "line": true,
   "slots": [
    {
     "x": 129.28,
     "y": 262.45,
     "angle": 24.86,
     "type": "T"
    },
    {
     "x": 152.92,
     "y": 278.17,
     "angle": 42.4,
     "type": "G"
    }
   ]
  },
  {
   "a": "TON",
   "b": "LVG",
   "terrain": "G",
   "bow": -0.4575,
   "line": false,
   "slots": [
    {
     "x": 188.89,
     "y": 283.51,
     "angle": 107.95,
     "type": "G"
    }
   ]
  },
  {
   "a": "TON",
   "b": "PHX",
   "terrain": "GBT",
   "bow": -0.7325,
   "line": false,
   "slots": [
    {
     "x": 217.77,
     "y": 264.18,
     "angle": 28.22,
     "type": "G"
    },
    {
     "x": 239.86,
     "y": 281.94,
     "angle": 49.36,
     "type": "B"
    },
    {
     "x": 254.06,
     "y": 306.46,
     "angle": 70.5,
     "type": "T"
    }
   ]
  },
  {
   "a": "LAX",
   "b": "SBD",
   "terrain": "G",
   "bow": -0.23,
   "line": true,
   "slots": [
    {
     "x": 53.14,
     "y": 331.3,
     "angle": -0.36,
     "type": "G"
    }
   ]
  },
  {
   "a": "SBD",
   "b": "LVG",
   "terrain": "BG",
   "bow": -0.045,
   "line": true,
   "slots": [
    {
     "x": 116.05,
     "y": 323.9,
     "angle": -17.35,
     "type": "B"
    },
    {
     "x": 143.36,
     "y": 315.77,
     "angle": -15.81,
     "type": "G"
    }
   ]
  },
  {
   "a": "LVG",
   "b": "PHX",
   "terrain": "BG",
   "bow": 0.23,
   "line": false,
   "slots": [
    {
     "x": 201.52,
     "y": 320.78,
     "angle": 21.73,
     "type": "B"
    },
    {
     "x": 228.68,
     "y": 329.35,
     "angle": 13.28,
     "type": "G"
    }
   ]
  },
  {
   "a": "SFE",
   "b": "PHX",
   "terrain": "T",
   "bow": 0.05,
   "line": true,
   "slots": [
    {
     "x": 278.88,
     "y": 296.27,
     "angle": 119.89,
     "type": "T"
    }
   ]
  },
  {
   "a": "SFE",
   "b": "ELP",
   "terrain": "GB",
   "bow": 0.28,
   "line": false,
   "slots": [
    {
     "x": 305.27,
     "y": 286.32,
     "angle": 75.96,
     "type": "G"
    },
    {
     "x": 314.6,
     "y": 312.67,
     "angle": 65.03,
     "type": "B"
    }
   ]
  },
  {
   "a": "DOD",
   "b": "ELP",
   "terrain": "GBT",
   "bow": 0.66,
   "line": false,
   "slots": [
    {
     "x": 376.37,
     "y": 267,
     "angle": 153,
     "type": "G"
    },
    {
     "x": 353.44,
     "y": 283.73,
     "angle": 134.72,
     "type": "B"
    },
    {
     "x": 336.91,
     "y": 306.8,
     "angle": 116.5,
     "type": "T"
    }
   ]
  },
  {
   "a": "DOD",
   "b": "AMA",
   "terrain": "B",
   "bow": 0.955,
   "line": false,
   "slots": [
    {
     "x": 400.14,
     "y": 284.88,
     "angle": 73.82,
     "type": "B"
    }
   ]
  },
  {
   "a": "DOD",
   "b": "WIC",
   "terrain": "BT",
   "bow": 0.245,
   "line": true,
   "slots": [
    {
     "x": 440.44,
     "y": 262.7,
     "angle": 2.65,
     "type": "B"
    },
    {
     "x": 468.91,
     "y": 262.01,
     "angle": -5.39,
     "type": "T"
    }
   ]
  },
  {
   "a": "ELP",
   "b": "AMA",
   "terrain": "TG",
   "bow": 0.17,
   "line": true,
   "slots": [
    {
     "x": 361.35,
     "y": 328.54,
     "angle": -16.08,
     "type": "T"
    },
    {
     "x": 388.29,
     "y": 319.28,
     "angle": -21.87,
     "type": "G"
    }
   ]
  },
  {
   "a": "AMA",
   "b": "WIC",
   "terrain": "GT",
   "bow": 0.4625,
   "line": true,
   "slots": [
    {
     "x": 454.33,
     "y": 296.46,
     "angle": -22.7,
     "type": "G"
    },
    {
     "x": 478.92,
     "y": 282.2,
     "angle": -37.56,
     "type": "T"
    }
   ]
  },
  {
   "a": "AMA",
   "b": "ABI",
   "terrain": "TB",
   "bow": 0.2475,
   "line": true,
   "slots": [
    {
     "x": 448.47,
     "y": 320.11,
     "angle": 22.6,
     "type": "T"
    },
    {
     "x": 475.5,
     "y": 329.06,
     "angle": 14.09,
     "type": "B"
    }
   ]
  },
  {
   "a": "WIC",
   "b": "KCY",
   "terrain": "T",
   "bow": 0,
   "line": true,
   "slots": [
    {
     "x": 540.8,
     "y": 246.94,
     "angle": -13.17,
     "type": "T"
    }
   ]
  },
  {
   "a": "WIC",
   "b": "ABI",
   "terrain": "BT",
   "bow": -0.485,
   "line": false,
   "slots": [
    {
     "x": 513.74,
     "y": 280.55,
     "angle": 77.08,
     "type": "B"
    },
    {
     "x": 515.37,
     "y": 308.24,
     "angle": 96.7,
     "type": "T"
    }
   ]
  },
  {
   "a": "WIC",
   "b": "FTW",
   "terrain": "GTB",
   "bow": -0.6925,
   "line": false,
   "slots": [
    {
     "x": 532.89,
     "y": 265.07,
     "angle": 28.17,
     "type": "G"
    },
    {
     "x": 555.33,
     "y": 282.42,
     "angle": 47.24,
     "type": "T"
    },
    {
     "x": 570.87,
     "y": 306.09,
     "angle": 66.08,
     "type": "B"
    }
   ]
  },
  {
   "a": "ABI",
   "b": "FTW",
   "terrain": "T",
   "bow": 0.0425,
   "line": true,
   "slots": [
    {
     "x": 543.12,
     "y": 335.92,
     "angle": 1.43,
     "type": "T"
    }
   ]
  }
 ],
 "labels": [
  {
   "city": "SEA",
   "text": "Seattle",
   "x": 43.94,
   "y": 15.2,
   "x0": 33.44,
   "y0": 12.62,
   "x1": 54.44,
   "y1": 17.78,
   "colour": "red"
  },
  {
   "city": "POR",
   "text": "Portland",
   "x": 22.01,
   "y": 149.14,
   "x0": 9.06,
   "y0": 146.56,
   "x1": 34.97,
   "y1": 151.72,
   "colour": "red"
  },
  {
   "city": "SAC",
   "text": "Sacramento",
   "x": 51.86,
   "y": 233.47,
   "x0": 33.44,
   "y0": 230.97,
   "x1": 70.27,
   "y1": 235.97,
   "colour": "red"
  },
  {
   "city": "LAX",
   "text": "Los Angeles",
   "x": 48.85,
   "y": 325.29,
   "x0": 30.4,
   "y0": 321.9,
   "x1": 67.31,
   "y1": 328.68,
   "colour": "red"
  },
  {
   "city": "YAK",
   "text": "Yakima",
   "x": 88.27,
   "y": 15.11,
   "x0": 77.39,
   "y0": 12.53,
   "x1": 99.14,
   "y1": 17.7,
   "colour": "dark"
  },
  {
   "city": "TDL",
   "text": "The Dalles",
   "x": 82.13,
   "y": 123.23,
   "x0": 66.04,
   "y0": 120.65,
   "x1": 98.21,
   "y1": 125.81,
   "colour": "dark"
  },
  {
   "city": "SPO",
   "text": "Spokane",
   "x": 162.98,
   "y": 79.5,
   "x0": 147.07,
   "y0": 75.35,
   "x1": 178.9,
   "y1": 83.65,
   "colour": "dark"
  },
  {
   "city": "BOI",
   "text": "Boise",
   "x": 164.3,
   "y": 108.29,
   "x0": 156.29,
   "y0": 104.31,
   "x1": 172.3,
   "y1": 112.27,
   "colour": "dark"
  },
  {
   "city": "REN",
   "text": "Reno",
   "x": 158.16,
   "y": 177.38,
   "x0": 148.67,
   "y0": 174.92,
   "x1": 167.64,
   "y1": 179.83,
   "colour": "dark"
  },
  {
   "city": "SLC",
   "text": "Salt Lake City",
   "x": 182.67,
   "y": 186.35,
   "x0": 161.8,
   "y0": 182.96,
   "x1": 203.54,
   "y1": 189.74,
   "colour": "dark"
  },
  {
   "city": "FRE",
   "text": "Fresno",
   "x": 94.11,
   "y": 239.27,
   "x0": 84.07,
   "y0": 236.81,
   "x1": 104.14,
   "y1": 241.72,
   "colour": "dark"
  },
  {
   "city": "TON",
   "text": "Tonopah",
   "x": 166.37,
   "y": 256.33,
   "x0": 152.99,
   "y0": 252.98,
   "x1": 179.75,
   "y1": 259.67,
   "colour": "dark"
  },
  {
   "city": "SBD",
   "text": "San Bernardino",
   "x": 120.82,
   "y": 333.76,
   "x0": 96.94,
   "y0": 331.05,
   "x1": 144.7,
   "y1": 336.47,
   "colour": "dark"
  },
  {
   "city": "LVG",
   "text": "Las Vegas",
   "x": 201,
   "y": 308.31,
   "x0": 186.1,
   "y0": 305.05,
   "x1": 215.9,
   "y1": 311.57,
   "colour": "dark"
  },
  {
   "city": "PHX",
   "text": "Phoenix",
   "x": 284.27,
   "y": 334.86,
   "x0": 270.17,
   "y0": 331.3,
   "x1": 298.37,
   "y1": 338.41,
   "colour": "dark"
  },
  {
   "city": "GFA",
   "text": "Great Falls",
   "x": 280.71,
   "y": 24.34,
   "x0": 264.58,
   "y0": 21.76,
   "x1": 296.84,
   "y1": 26.92,
   "colour": "dark"
  },
  {
   "city": "HEL",
   "text": "Helena",
   "x": 296.16,
   "y": 83.86,
   "x0": 285.67,
   "y0": 81.28,
   "x1": 306.66,
   "y1": 86.44,
   "colour": "dark"
  },
  {
   "city": "BIL",
   "text": "Billings",
   "x": 317.97,
   "y": 70.27,
   "x0": 307,
   "y0": 66.89,
   "x1": 328.93,
   "y1": 73.66,
   "colour": "dark"
  },
  {
   "city": "DEN",
   "text": "Denver",
   "x": 280.97,
   "y": 155.87,
   "x0": 270,
   "y0": 153.42,
   "x1": 291.93,
   "y1": 158.33,
   "colour": "dark"
  },
  {
   "city": "SFE",
   "text": "Santa Fe",
   "x": 276.82,
   "y": 259.63,
   "x0": 263.74,
   "y0": 257.13,
   "x1": 289.9,
   "y1": 262.13,
   "colour": "dark"
  },
  {
   "city": "ELP",
   "text": "El Paso",
   "x": 308.06,
   "y": 335.92,
   "x0": 299.3,
   "y0": 333.33,
   "x1": 316.82,
   "y1": 338.5,
   "colour": "dark"
  },
  {
   "city": "BIS",
   "text": "Bismarck",
   "x": 470.79,
   "y": 73.36,
   "x0": 456.95,
   "y0": 70.78,
   "x1": 484.63,
   "y1": 75.95,
   "colour": "dark"
  },
  {
   "city": "FAR",
   "text": "Fargo",
   "x": 526.84,
   "y": 8.26,
   "x0": 518.41,
   "y0": 5,
   "x1": 535.26,
   "y1": 11.51,
   "colour": "dark"
  },
  {
   "city": "NPL",
   "text": "North Platte",
   "x": 446.11,
   "y": 107.15,
   "x0": 424.86,
   "y0": 104.56,
   "x1": 467.36,
   "y1": 109.73,
   "colour": "dark"
  },
  {
   "city": "SXC",
   "text": "Sioux City",
   "x": 494.5,
   "y": 134.62,
   "x0": 478.96,
   "y0": 131.23,
   "x1": 510.03,
   "y1": 138.01,
   "colour": "dark"
  },
  {
   "city": "PUE",
   "text": "Pueblo",
   "x": 399.46,
   "y": 178.31,
   "x0": 387.43,
   "y0": 175.68,
   "x1": 411.48,
   "y1": 180.93,
   "colour": "dark"
  },
  {
   "city": "GRI",
   "text": "Grand Island",
   "x": 421.64,
   "y": 187.41,
   "x0": 402,
   "y0": 184.83,
   "x1": 441.28,
   "y1": 189.99,
   "colour": "dark"
  },
  {
   "city": "DOD",
   "text": "Dodge City",
   "x": 380.2,
   "y": 247.31,
   "x0": 362.8,
   "y0": 243.92,
   "x1": 397.59,
   "y1": 250.7,
   "colour": "dark"
  },
  {
   "city": "WIC",
   "text": "Wichita",
   "x": 503.47,
   "y": 240.92,
   "x0": 491.83,
   "y0": 238.34,
   "x1": 515.11,
   "y1": 243.5,
   "colour": "dark"
  },
  {
   "city": "AMA",
   "text": "Amarillo",
   "x": 394.5,
   "y": 304.67,
   "x0": 381.34,
   "y0": 302.09,
   "x1": 407.67,
   "y1": 307.26,
   "colour": "dark"
  },
  {
   "city": "ABI",
   "text": "Abilene",
   "x": 528.07,
   "y": 322.79,
   "x0": 516.21,
   "y0": 320.21,
   "x1": 539.92,
   "y1": 325.37,
   "colour": "dark"
  },
  {
   "city": "MIN",
   "text": "Minneapolis",
   "x": 550.97,
   "y": 47.79,
   "x0": 531.96,
   "y0": 44.45,
   "x1": 569.98,
   "y1": 51.14,
   "colour": "blue"
  },
  {
   "city": "OMA",
   "text": "Omaha",
   "x": 577.93,
   "y": 162.18,
   "x0": 566.93,
   "y0": 159.6,
   "x1": 588.94,
   "y1": 164.76,
   "colour": "blue"
  },
  {
   "city": "KCY",
   "text": "Kansas City",
   "x": 578.27,
   "y": 253.66,
   "x0": 560.66,
   "y0": 250.27,
   "x1": 595.88,
   "y1": 257.05,
   "colour": "blue"
  },
  {
   "city": "FTW",
   "text": "Fort Worth",
   "x": 578.06,
   "y": 320.08,
   "x0": 561.09,
   "y0": 316.31,
   "x1": 595.04,
   "y1": 323.85,
   "colour": "blue"
  }
 ],
 "checks": [
  {
   "ok": true,
   "rule": "Read from the map art; slot positions and angles are not solved",
   "measured": "35 cities, 65 routes, 134 slots"
  },
  {
   "ok": true,
   "rule": "Matches the manual reading of every route (pair and terrain order)",
   "measured": "65 of 65"
  },
  {
   "ok": true,
   "rule": "Slot icon matches slot colour",
   "measured": "134 of 134 (Los Angeles-San Bernardino slot partly under its label, checked by eye)"
  },
  {
   "ok": true,
   "rule": "Terrain counts",
   "measured": "Ground 46 / Tunnel 44 / Bridge 41 / wild 3"
  }
 ]
};
