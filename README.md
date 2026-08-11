# Lunar Water Migration Simulation

An interactive Three.js visualization of lunar illumination, Diviner surface temperatures, and thermally driven water migration. Water molecules adsorb to the terrain, desorb probabilistically, follow ballistic trajectories under lunar gravity, and adsorb again when they land.

[View the live simulation](https://atmarc.github.io/graphic-moon/).

![Lunar water particle simulation](./screenshot.png)

## Data sources

- Surface temperatures are spatially and temporally interpolated from [Diviner snapshots](https://luna1.diviner.ucla.edu/~jpierre/diviner/level4_raster_data/).
- The surface color map is derived from the LRO Camera Wide Angle Camera mosaic distributed in NASA's [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/).
- Terrain elevation is derived from the Lunar Orbiter Laser Altimeter gridded DEM distributed in NASA's [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/).
## Physical Model
- Desorption uses the rate and timestep survival probability as in [Peschel et al. (2026)](https://iopscience.iop.org/article/10.3847/PSJ/ae4901/meta).
- Adsorption energies follow the [Schörghofer (2023)](https://doi.org/10.3847/PSJ/acf19b) exponential fit with `E_p = 0.65 eV`, `W = 0.22 eV`, and a normalized upper truncation at `1.55 eV`.
- Launch velocities follow the Maxwell-Boltzmann flux distribution and are rotated by the local terrain normal.
- Flights use a two-second velocity-Verlet integration under three-dimensional central lunar gravity.


## Project Structure

- `main.js`: application state, tabs, controls, and rendering loop.
- `water-simulation.js`: adsorption, desorption, launch sampling, and flight physics.
- `simulation-renderer.js`: particle markers and bounded latest-hop traces.
- `diviner.js`: Diviner data loading and temperature interpolation.
- `moon.js`: lunar terrain mesh, illumination, and thermal shader.
